"""Email delivery for workspace invitations via Resend or SMTP."""

from __future__ import annotations

import html
import base64
import json
import smtplib
import ssl
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import quote

from app.core.config import Settings


def invitation_url(settings: Settings, token: str, frontend_base_url: str | None = None) -> str:
    base_url = frontend_base_url or settings.frontend_base_url
    return f"{base_url.rstrip('/')}/?invite={quote(token, safe='')}"


def send_invitation_email(
    settings: Settings,
    recipient: str,
    workspace_name: str,
    role: str,
    url: str,
) -> None:
    safe_workspace = html.escape(workspace_name)
    safe_role = html.escape(role.lower())
    safe_url = html.escape(url, quote=True)
    text_content = (
        f"You have been invited to join {workspace_name} as a {role.lower()}.\n\n"
        f"Accept the invitation within 7 days: {url}\n"
    )
    html_content = (
        "<html><body>"
        f"<p>You have been invited to join <strong>{safe_workspace}</strong> as a {safe_role}.</p>"
        f'<p><a href="{safe_url}">Accept invitation</a></p>'
        "<p>This invitation expires in 7 days.</p>"
        "</body></html>"
    )

    if settings.gmail_configured:
        token_request = Request(
            "https://oauth2.googleapis.com/token",
            data=urlencode({
                "client_id": settings.gmail_client_id,
                "client_secret": settings.gmail_client_secret,
                "refresh_token": settings.gmail_refresh_token,
                "grant_type": "refresh_token",
            }).encode("utf-8"),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(token_request, timeout=settings.smtp_timeout_seconds) as response:
                access_token = json.loads(response.read().decode("utf-8"))["access_token"]
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"Gmail OAuth token request failed: {detail}") from exc
        except (URLError, KeyError, ValueError) as exc:
            raise RuntimeError(f"Could not authorize Gmail email delivery: {exc}") from exc

        message = EmailMessage()
        message["Subject"] = f"You're invited to join {workspace_name}"
        message["From"] = formataddr((settings.smtp_from_name, settings.gmail_sender_email))
        message["To"] = recipient
        message.set_content(text_content)
        message.add_alternative(html_content, subtype="html")
        raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode("ascii").rstrip("=")
        send_request = Request(
            "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
            data=json.dumps({"raw": raw_message}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(send_request, timeout=settings.smtp_timeout_seconds) as response:
                if response.status >= 300:
                    raise RuntimeError(f"Gmail API returned HTTP {response.status}")
            return
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise RuntimeError(f"Gmail API rejected the message: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Could not reach Gmail API: {exc.reason}") from exc

    if settings.resend_api_key and settings.email_from:
        payload = json.dumps({
            "from": settings.email_from,
            "to": [recipient],
            "subject": f"You're invited to join {workspace_name}",
            "text": text_content,
            "html": html_content,
        }).encode("utf-8")
        request = Request(
            "https://api.resend.com/emails",
            data=payload,
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=settings.smtp_timeout_seconds) as response:
                if response.status >= 300:
                    raise RuntimeError(f"Email provider returned HTTP {response.status}")
            return
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"Email provider rejected the message: {detail}") from exc
        except URLError as exc:
            raise RuntimeError(f"Could not reach the email provider: {exc.reason}") from exc

    if not settings.smtp_configured:
        raise RuntimeError("Email settings are incomplete")

    message = EmailMessage()
    message["Subject"] = f"You're invited to join {workspace_name}"
    message["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    message["To"] = recipient
    message.set_content(text_content)
    message.add_alternative(html_content, subtype="html")

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
