from pydantic import BaseModel, ConfigDict, Field


class PromptAssembleRequest(BaseModel):
    """Input to the prompt assembler."""

    model_config = ConfigDict(populate_by_name=True)

    scene_prompt: str = Field(alias="scenePrompt", min_length=1)
    dna_prompt: str = Field(alias="dnaPrompt", default="")
    trigger_word: str = Field(alias="triggerWord", default="")
    costume_prompt: str = Field(alias="costumePrompt", default="")
    # Optional user override: if provided, skip assembly and use this directly.
    override_prompt: str | None = Field(default=None, alias="overridePrompt")


class PromptComponent(BaseModel):
    """A single named contribution to the assembled prompt."""

    model_config = ConfigDict(populate_by_name=True)

    source: str  # "trigger_word" | "dna_prompt" | "costume_prompt" | "scene_prompt" | "override"
    label: str  # Human-readable Chinese label
    content: str  # The actual text contributed (may be empty if deduped away)
    active: bool  # False if this component was entirely removed by deduplication


class AssembledPromptResponse(BaseModel):
    """Result of prompt assembly."""

    model_config = ConfigDict(populate_by_name=True)

    assembled: str  # The final prompt to send to the image engine
    token_count: int = Field(alias="tokenCount")  # Naive whitespace-split token count
    components: list[PromptComponent]
    was_overridden: bool = Field(alias="wasOverridden")
