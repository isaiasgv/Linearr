"""ai toolset — Linearr's own AI advisors.

Every tool here returns a PROPOSAL and writes nothing, so they are annotated
read-only. Each call spends the operator's OpenAI credits through the key
configured in Settings, and each docstring says so: an assistant that can
already reason about the library should usually do this itself rather than
paying for a second model to do it.
"""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="ai_suggest_channels", toolset="ai",
              read_only=True, open_world=True)
    async def ai_suggest_channels() -> dict:
        """Propose new channels and channel packages from the current lineup and
        library. Returns suggestions only — nothing is created. Spends the OpenAI
        credits of the key configured in Linearr's Settings."""
        try:
            return await api.ai_suggest_channels()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_suggest_channel_content", toolset="ai",
              read_only=True, open_world=True)
    async def ai_suggest_channel_content(channel_number: int) -> dict:
        """Propose library content that would suit a channel's vibe. Returns
        suggestions only. Spends the configured OpenAI key's credits."""
        try:
            return await api.ai_content_suggestions(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_network_advisor", toolset="ai",
              read_only=True, open_world=True)
    async def ai_network_advisor() -> dict:
        """Review the whole lineup — gaps, overlaps, balance. Advice only. Spends
        the configured OpenAI key's credits."""
        try:
            return await api.network_ai_advisor()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_generate_day", toolset="ai", read_only=True, open_world=True)
    async def ai_generate_day(channel_number: int, style: str = "cable") -> dict:
        """Draft a full day of schedule blocks for a channel. style: cable | kids |
        anime | movies. Returns the draft — create the blocks yourself with
        `create_block`. Spends the configured OpenAI key's credits."""
        try:
            return await api.ai_generate_full_day(
                api.AIFullDayIn(channel_number=channel_number, style=style))
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="ai_autofill_block", toolset="ai",
              read_only=True, open_world=True)
    async def ai_autofill_block(block_id: int,
                                channel_number: int | None = None) -> dict:
        """Draft slots to fill a block from the channel's assigned content. Returns
        the draft — add them yourself with `add_block_slot`. Spends the configured
        OpenAI key's credits."""
        try:
            return await api.ai_autofill_block(
                block_id, api.AIAutofillIn(channel_number=channel_number))
        except HTTPException as e:
            raise tool_error(e)
