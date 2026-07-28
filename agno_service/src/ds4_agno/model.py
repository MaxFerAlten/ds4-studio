from agno.models.openai.like import OpenAILike

def create_ds4_model(settings: "Settings") -> OpenAILike:
    """Create an OpenAILike instance pointing to the DS4 model gateway."""
    base_url = f"{settings.ds4_studio_base_url.rstrip('/')}/api/agno-model/v1"
    return OpenAILike(
        id=settings.ds4_model,
        name="DS4 OpenAI-Compatible",
        api_key=settings.model_gateway_token,
        base_url=base_url,
        timeout=settings.model_timeout_seconds,
        max_retries=0,
    )
