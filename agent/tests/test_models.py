import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
import numpy
from starlette.testclient import TestClient

from contextlens import models
from contextlens.api import app
from contextlens.models import catalog, local_embedding, settings

KEY = "sk-test-0123456789abcdef"


class ModelSettingsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._env = patch.dict(os.environ, {"CONTEXTLENS_HOME": self._tmp.name}, clear=False)
        self._env.start()
        for name in ("OPENAI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_MODEL"):
            os.environ.pop(name, None)
        # Never touch the network: models.dev is "down", so the built-in catalog is used.
        self._offline = patch.object(catalog, "_fetch", side_effect=httpx.ConnectError("offline"))
        self._offline.start()
        catalog._memo = None
        self.client = TestClient(app)

    def tearDown(self):
        catalog._memo = None
        self._offline.stop()
        self._env.stop()
        self._tmp.cleanup()

    def test_catalog_works_offline_and_keeps_tool_capable_models(self):
        deepseek = models.providers()["deepseek"]
        self.assertEqual(deepseek["base_url"], "https://api.deepseek.com")
        self.assertEqual(models.providers()["openai"]["base_url"], "https://api.openai.com/v1")
        self.assertEqual(models.providers()["openai"]["models"]["text-embedding-3-small"]["kind"], "embedding")

    def test_catalog_keeps_usable_models_and_marks_current_ones(self):
        def model(family, released, **extra):
            return {"name": family, "family": family, "tool_call": True, "release_date": released, **extra}
        raw = {"acme": {"id": "acme", "name": "Acme", "npm": "@ai-sdk/openai-compatible", "api": "https://acme.test",
                        "models": {
                            "a-2": model("a", "2026-09", reasoning_options=[
                                {"type": "toggle"}, {"type": "effort", "values": ["low", "high"]}]),
                            "a-1": model("a", "2026-03-01"),
                            "b-1": model("b", "2025-06-01"),
                            "a-latest": model("a", "2026-09-02", canonical_model_id="acme/a-2"),
                            "old": model("c", "2024-01-01", status="deprecated"),
                            "voice": model("v", "2026-09-03", type="realtime"),
                        }}}
        models_ = catalog._normalize(raw)["acme"]["models"]
        # Aliases, deprecated and non-chat models are gone; the rest are newest first.
        self.assertEqual(list(models_), ["a-2", "a-1", "b-1"])
        # Newest of each family, within a year of the provider's newest ("2026-09" → from "2025-09").
        self.assertEqual([m for m, v in models_.items() if v["current"]], ["a-2"])
        self.assertEqual(models_["a-2"]["efforts"], ["none", "low", "high"])
        self.assertIsNone(models_["a-1"]["efforts"])

    def test_saved_key_is_owner_only_and_never_returned(self):
        res = self.client.put("/lens/settings/providers/deepseek", json={"api_key": KEY})
        self.assertEqual(res.status_code, 200)
        self.assertNotIn(KEY, res.text)
        self.assertNotIn(KEY, self.client.get("/lens/settings").text)
        mode = stat.S_IMODE((Path(self._tmp.name) / "settings.json").stat().st_mode)
        self.assertEqual(mode, 0o600)
        row = next(p for p in res.json()["providers"] if p["id"] == "deepseek")
        self.assertTrue(row["connected"])

    def test_environment_variables_are_not_a_source(self):
        os.environ["DEEPSEEK_API_KEY"] = "from-env"
        os.environ["OPENAI_API_KEY"] = "from-env"
        self.assertEqual(settings.credentials(models.providers()["deepseek"])[0], None)
        self.assertIsNone(models.overview()["roles"]["agent"])
        with self.assertRaises(models.NotConfigured):
            models.chat_model("agent")

    def test_roles_build_compatible_clients(self):
        settings.save_provider("deepseek", KEY)
        settings.set_roles({"agent": "deepseek/deepseek-flash"})
        model = models.chat_model("agent")
        self.assertEqual(model.model_name, "deepseek-flash")
        self.assertEqual(str(model.openai_api_base), "https://api.deepseek.com")
        # Reasoning must round-trip during tool loops; only /responses carries it back.
        self.assertTrue(model.use_responses_api)
        # Memory upkeep follows the agent until it is set on its own.
        self.assertEqual(models.role_spec("memory"), ("deepseek", "deepseek-flash"))

    def test_openai_keeps_nothing_on_its_side(self):
        settings.save_provider("openai", KEY)
        settings.set_roles({"agent": "openai/gpt-5-nano"})
        model = models.chat_model("agent")
        self.assertTrue(model.use_responses_api)
        self.assertFalse(model.store)
        self.assertEqual(model.include, ["reasoning.encrypted_content"])

    def test_reasoning_effort_applies_only_where_the_model_takes_it(self):
        settings.save_provider("deepseek", KEY)
        settings.set_roles({"agent": "deepseek/deepseek-flash"})
        listed = self.client.get("/lens/settings/providers/deepseek/models").json()["models"]
        self.assertEqual(listed[0]["efforts"], ["none", "low", "high", "max"])
        self.client.put("/lens/settings/efforts", json={"agent": "max"})
        self.assertEqual(models.chat_model("agent").reasoning, {"effort": "max"})
        # Upkeep after each turn keeps to the lightest effort unless set on its own.
        self.assertEqual(models.chat_model("memory").reasoning, {"effort": "none"})
        # DeepSeek has no "medium": the provider's default applies instead of a rejected request.
        self.client.put("/lens/settings/efforts", json={"agent": "medium"})
        self.assertIsNone(models.chat_model("agent").reasoning)

    def test_the_user_chooses_which_models_the_picker_shows(self):
        def shown():
            listed = self.client.get("/lens/settings/providers/openai/models").json()["models"]
            return [m["id"] for m in listed if m["shown"]]
        self.assertEqual(shown(), ["gpt-5-mini"])  # the catalog's current ones by default
        self.client.put("/lens/settings/providers/openai/shown", json={"models": ["text-embedding-3-small"]})
        self.assertEqual(shown(), ["text-embedding-3-small"])
        self.client.put("/lens/settings/providers/openai/shown", json={"models": None})
        self.assertEqual(shown(), ["gpt-5-mini"])

    def test_forgetting_a_provider_clears_its_roles(self):
        settings.save_provider("deepseek", KEY)
        settings.set_roles({"agent": "deepseek/deepseek-flash"})
        self.client.delete("/lens/settings/providers/deepseek")
        self.assertIsNone(models.overview()["roles"]["agent"])
        with self.assertRaises(models.NotConfigured):
            models.chat_model("agent")

    def test_test_masks_the_key_in_errors(self):
        settings.save_provider("deepseek", KEY)
        with patch("langchain_openai.ChatOpenAI.invoke", side_effect=RuntimeError(f"bad key {KEY}")):
            result = models.test("deepseek", "deepseek-flash")
        self.assertFalse(result["ok"])
        self.assertNotIn(KEY, result["error"])

    def test_requests_from_web_pages_are_refused(self):
        res = self.client.get("/lens/settings", headers={"origin": "https://evil.example"})
        self.assertEqual(res.status_code, 403)
        res = self.client.put("/lens/settings/roles", json={"agent": "x/y"}, headers={"origin": "http://localhost:3001"})
        self.assertEqual(res.status_code, 403)


class LocalEmbeddingTests(unittest.TestCase):
    def test_only_a_query_carries_the_models_prompt(self):
        seen = []

        class Model:
            def embed(self, texts, batch_size):
                seen.extend(texts)
                return [numpy.zeros(2) for _ in texts]

        with patch.object(local_embedding, "_model", return_value=Model()):
            local_embedding.LocalEmbeddings().embed_documents(["a memory"])
            local_embedding.LocalEmbeddings().embed_query("a question")
        self.assertEqual(seen[0], "a memory")
        self.assertTrue(seen[1].startswith("Instruct:"))
        self.assertTrue(seen[1].endswith("Query:a question"))


if __name__ == "__main__":
    unittest.main()
