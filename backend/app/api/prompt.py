from fastapi import APIRouter

from app.schemas.prompt import AssembledPromptResponse, PromptAssembleRequest
from app.services.prompt_assembler import assemble_prompt

router = APIRouter()


@router.post("/prompt/assemble", response_model=AssembledPromptResponse)
def assemble_prompt_endpoint(payload: PromptAssembleRequest) -> AssembledPromptResponse:
    return assemble_prompt(payload)
