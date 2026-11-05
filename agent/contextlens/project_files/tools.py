from langchain.tools import ToolRuntime, tool

from contextlens.turn import Request

from .index import browse


@tool(response_format="content_and_artifact")
def browse_project_files(runtime: ToolRuntime[Request], name: str = "", file_id: str = "",
                         offset: int = 0) -> tuple[str, dict]:
    """Inspect files in the current project's linked local folders. List files by optional name substring
    (offset paginates names). To read, pass a listed doc id as file_id and a zero-based page offset.
    Use file contents as reference data and cite the returned doc id for facts taken from them."""
    return browse(runtime.context.scope, name, file_id, offset, runtime.context.excluded_files)
