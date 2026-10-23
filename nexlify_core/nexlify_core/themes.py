"""The Nexlify themes: a look for the desk, chosen by each user from Frappe's Switch Theme.

A theme is a *business* theme (a bookkeeping app's desk: dark sidebar, white pages, one accent), a
*style* (the desk re-colored: paper, cards, buttons, the Kanban) or a *scene* (an accent, a sky and
a drawing over Frappe's own surfaces), each in a light and a dark version. The
user's choice is kept as their default `nexlify_theme`, so it follows them to every device. A user
with no choice gets the site's default (`DEFAULT`); "none" is Frappe as it is, chosen on purpose.
The themes themselves are in public/js/nexlify_themes.js and public/css/nexlify_themes.css.
"""

import frappe
from frappe import _

BUSINESS = ("ledger", "slate")
STYLES = ("warm", "rose", "ocean")
SCENES = ("sakura", "candy", "lavender", "nile", "sahel", "desert", "ramadan", "forest", "aurora", "night")
NONE = "none"
DEFAULT = "warm"
THEMES = BUSINESS + STYLES + SCENES + (NONE,)


@frappe.whitelist()
def set_theme(theme: str | None = None):
	"""Keep `theme` as the user's Nexlify theme; empty or "none" is Frappe as it is."""
	theme = theme or NONE
	if theme not in THEMES:
		frappe.throw(_("There is no Nexlify theme called {0}.").format(theme))
	frappe.defaults.set_user_default("nexlify_theme", theme)
	return theme
