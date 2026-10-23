import re

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.core.exceptions import PermissionDenied
from django.urls import resolve
from django.utils.deprecation import MiddlewareMixin


class LoginRequiredMiddleware(MiddlewareMixin):
    def process_request(self, request):
        if request.user.is_authenticated:
            return

        if request.headers.get('x-requested-with') == 'XMLHttpRequest':
            raise PermissionDenied

        resolver = resolve(request.path)
        ignored_views = getattr(settings, 'LOGIN_REQUIRED_IGNORE_VIEW_NAMES', [])
        ignored_paths = [settings.LOGIN_URL]
        ignored_paths.extend(getattr(settings, 'LOGIN_REQUIRED_IGNORE_PATHS', []))

        if resolver.view_name not in ignored_views and not any(
            re.match(path, request.path) for path in ignored_paths
        ):
            return redirect_to_login(request.get_full_path())