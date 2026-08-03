"""watermark toolset — per-channel Tunarr watermark configuration.

Validation mirrors Tunarr's own zod rules, so a bad value fails here with a
readable message instead of coming back as an opaque 400 from Tunarr.
"""
from fastapi import HTTPException

from .registry import tool_error


def register(reg, api):

    @reg.tool(name="get_channel_watermark", toolset="watermark", read_only=True)
    async def get_channel_watermark(channel_number: int) -> dict:
        """Read a channel's watermark config. `{"watermark": null}` means none is set."""
        try:
            return api.get_channel_watermark(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_channel_watermark", toolset="watermark",
              idempotent=True, open_world=True)
    async def set_channel_watermark(
        channel_number: int, enabled: bool = False,
        position: str = "bottom-right", width: float = 7.0,
        vertical_margin: float = 5.0, horizontal_margin: float = 5.0,
        duration: float = 0.0, opacity: int = 20, fixed_size: bool = False,
        use_channel_icon: bool = True, fade_period_mins: int | None = None,
        fade_leading_edge: bool = True,
    ) -> dict:
        """Set a channel's watermark and re-sync it to Tunarr.

        position: top-left | top-right | bottom-left | bottom-right.
        `width` is a percent of frame width and must be > 0 (inert when
        `fixed_size`). opacity 0-100, margins 0-100, `duration` in seconds
        (0 = always on). Set `fade_period_mins` (>= 1) to fade it in and out.

        No image is required. With none set, Linearr omits the image URL from the
        Tunarr payload and Tunarr draws the channel's own icon. Call
        `set_watermark_image` only to use a DIFFERENT image from the icon."""
        fade = (api.WatermarkFade(period_mins=fade_period_mins,
                                  leading_edge=fade_leading_edge)
                if fade_period_mins is not None else None)
        try:
            body = api.WatermarkIn(
                enabled=enabled, position=position, width=width,
                vertical_margin=vertical_margin, horizontal_margin=horizontal_margin,
                duration=duration, opacity=opacity, fixed_size=fixed_size,
                use_channel_icon=use_channel_icon, fade=fade)
        except ValueError as e:
            raise RuntimeError(str(e))
        try:
            return await api.put_channel_watermark(channel_number, body)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="clear_channel_watermark", toolset="watermark",
              destructive=True, idempotent=True, open_world=True)
    async def clear_channel_watermark(channel_number: int) -> dict:
        """Remove a channel's watermark and push `enabled: false` to Tunarr."""
        try:
            return await api.delete_channel_watermark(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="audit_watermarks", toolset="watermark", read_only=True)
    async def audit_watermarks() -> dict:
        """Find channels that will NOT PLAY because their watermark is enabled with
        no image. Tunarr builds a dangling ffmpeg `-i` for those, the transcode
        exits 254, no playlist is written and the channel 404s in a retry loop.
        `can_use_icon` marks the ones `repair_watermarks` can fix while keeping the
        watermark; the rest can only be switched off."""
        try:
            return api.watermark_audit()
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="repair_watermarks", toolset="watermark",
              idempotent=True, open_world=True)
    async def repair_watermarks(channel_number: int | None = None) -> dict:
        """Fix channels stuck with an enabled, imageless watermark so they play
        again. Per channel: upload its icon and keep the watermark if it has one,
        otherwise switch the watermark off. Omit `channel_number` to repair every
        affected channel; run `audit_watermarks` first to see what will change."""
        try:
            return await api.watermark_repair(channel_number)
        except HTTPException as e:
            raise tool_error(e)

    @reg.tool(name="set_watermark_image", toolset="watermark",
              idempotent=True, open_world=True)
    async def set_watermark_image(channel_number: int, image: str | None = None,
                                  url: str | None = None) -> dict:
        """Resolve the watermark image to an absolute URL Tunarr can fetch.

        Pass `url` (an absolute URL, stored as-is), `image` (a data URI, uploaded
        to Tunarr), or neither to use the channel's icon. This step exists
        because Tunarr hands the value to ffmpeg as an HTTP input and ffmpeg
        cannot read a `data:` URI — which is also why inheriting the channel icon
        is an upload, not a copy."""
        try:
            return await api.set_channel_watermark_image(
                channel_number, api.WatermarkImageIn(image=image, url=url))
        except HTTPException as e:
            raise tool_error(e)
