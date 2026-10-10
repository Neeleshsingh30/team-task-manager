"""SMTP delivery for workspace invitations."""

from __future__ import annotations

import html
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import quote

from app.core.config import Settings


def invitation_url(settings: Settings, token: str) -> str:
    return f"{settings.frontend_base_url.rstrip('/')}/?invite={quote(token, safe='')}"


def send_invitation_email(
    settings: Settings,
    recipient: str,
    workspace_name: str,
    role: str,
    url: str,
) -> None:
    if not settings.smtp_configured:
        raise RuntimeError("SMTP email settings are incomplete")

    safe_workspace = html.escape(workspace_name)
    safe_role = html.escape(role.lower())
    safe_url = html.escape(url, quote=True)
    message = EmailMessage()
    message["Subject"] = f"You're invited to join {workspace_name}"
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = recipient
    message.set_content(
        f"You have been invited to join {workspace_name} as a {role.lower()}.\n\n"
        f"Accept the invitation within 7 days: {url}\n"
    )
    message.add_alternative(
        "<html><body>"
        f"<p>You have been invited to join <strong>{safe_workspace}</strong> as a {safe_role}.</p>"
        f'<p><a href="{safe_url}">Accept invitation</a></p>'
        "<p>This invitation expires in 7 days.</p>"
        "</body></html>",
        subtype="html",
    )

    if settings.smtp_use_ssl:
        smtp = smtplib.SMTP_SSL(
            settings.smtp_host,
            settings.smtp_port,
            timeout=settings.smtp_timeout_seconds,
            context=ssl.create_default_context(),
        )
    else:
        smtp = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=settings.smtp_timeout_seconds)

    with smtp:
        smtp.ehlo()
        if settings.smtp_starttls and not settings.smtp_use_ssl:
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
        smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(message)
