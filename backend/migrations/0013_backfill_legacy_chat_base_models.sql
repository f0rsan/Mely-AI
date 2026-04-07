UPDATE character_chats
SET base_model_name = COALESCE(
    NULLIF(TRIM((
        SELECT default_base_model_name
        FROM characters
        WHERE characters.id = character_chats.character_id
    )), ''),
    'qwen2.5:7b-instruct-q4_K_M'
)
WHERE llm_model_id IS NULL
  AND (base_model_name IS NULL OR TRIM(base_model_name) = '');
