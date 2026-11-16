"""Each invoice line its own row in the General Ledger.

ERPNext adds up a sales or purchase invoice's lines that share an account, cost center, project and
dimensions into one General Ledger row. With Accounts Settings > Keep Each Invoice Line in the Ledger
ticked, every line keeps a row of its own: the row carries the line's id (voucher_detail_no, which
ERPNext keeps rows apart by) and the line's description. Unticked, ERPNext posts as it always does.
It applies to invoices posted after it is ticked; posted ones keep their rows until they are posted
again (Repost Accounting Ledger).

It never stops a posting. An ERPNext update may change how invoices build their ledger rows: then the
invoice is posted the usual way (lines added up), and the people with the System Manager role are told
the same day (a bell notification, an Error Log, "Not working since" on Accounts Settings). Once it works
again the note on Accounts Settings goes by itself; the invoices posted between are found by
not_split_since() and are split by Repost Accounting Ledger.
"""

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, now_datetime, nowdate, strip_html

SETTING = "keep_invoice_lines_in_ledger"
# when it stopped working (empty while it works), and how many invoices were posted the usual way since
STOPPED = "keep_invoice_lines_stopped_since"
MISSED = "keep_invoice_lines_missed"
LINE_DOCTYPES = ("Sales Invoice Item", "Purchase Invoice Item")
INVOICES = {"Sales Invoice": "Sales Invoice Item", "Purchase Invoice": "Purchase Invoice Item"}
ERROR_TITLE = "Keep Each Invoice Line in the Ledger stopped working"


def keep_lines():
	if not frappe.get_meta("Accounts Settings").has_field(SETTING):
		return False
	return cint(frappe.db.get_single_value("Accounts Settings", SETTING))


def line_remark(item):
	"""The line's own words for its ledger row: its description, else its item name."""
	text = strip_html(item.get("description") or "").strip() or (item.get("item_name") or "").strip()
	return text[:500] or None


def line_of(rest, kwargs):
	"""The invoice line ERPNext builds a row for: get_gl_dict(args, account_currency, item)."""
	if "item" in kwargs:
		return kwargs["item"]
	return rest[1] if len(rest) > 1 else None


def with_line(doc, args, item):
	if (
		item is not None
		and item.get("doctype") in LINE_DOCTYPES
		and item.get("name")
		and not args.get("voucher_detail_no")
		and keep_lines()
	):
		args = frappe._dict(args)
		args.voucher_detail_no = item.name
		if not args.get("remarks"):
			args.remarks = line_remark(item) or doc.get("remarks")
	return args


class InvoiceLinesMixin:
	def get_gl_dict(self, args, *rest, **kwargs):
		# whatever ERPNext passes is passed on as it came: a change in ERPNext never stops the posting
		try:
			args = with_line(self, args, line_of(rest, kwargs))
		except Exception:
			frappe.flags.nexlify_invoice_lines_error = frappe.get_traceback()
		return super().get_gl_dict(args, *rest, **kwargs)


def check_posted(doc, method=None):
	"""After an invoice is posted: each of its lines with an amount has a ledger row of its own. When none has
	(ERPNext changed how it builds them), the people who manage the site are told; when they have again, the
	note goes. Never stops the posting."""
	try:
		if doc.doctype not in INVOICES or not keep_lines():
			return
		lines = {row.name for row in doc.get("items") or [] if flt(row.get("base_net_amount"))}
		if not lines:
			return
		split = frappe.get_all(
			"GL Entry",
			filters={
				"voucher_type": doc.doctype,
				"voucher_no": doc.name,
				"is_cancelled": 0,
				"voucher_detail_no": ("in", list(lines)),
			},
			pluck="voucher_detail_no",
		)
		if split:
			working_again()
		else:
			stopped(doc, frappe.flags.pop("nexlify_invoice_lines_error", None))
	except Exception:
		frappe.log_error(title=ERROR_TITLE, message=frappe.get_traceback())


def stopped(doc, error=None):
	"""It did not work for this invoice: counted on Accounts Settings, and told once a day."""
	since = frappe.db.get_single_value("Accounts Settings", STOPPED)
	missed = cint(frappe.db.get_single_value("Accounts Settings", MISSED)) + 1
	if not since:
		since = now_datetime()
		frappe.db.set_single_value("Accounts Settings", STOPPED, since)
	frappe.db.set_single_value("Accounts Settings", MISSED, missed)
	key = f"nexlify_core:invoice_lines_told:{nowdate()}"
	if frappe.cache.get_value(key):
		return
	frappe.cache.set_value(key, 1, expires_in_sec=26 * 3600)
	message = _(
		"{0} {1} was posted with its lines added up: Keep Each Invoice Line in the Ledger stopped working "
		"(most likely after an ERPNext update). Invoices are posted the usual way until it is fixed."
	).format(_(doc.doctype), doc.name)
	frappe.log_error(title=ERROR_TITLE, message=f"{message}\n\n{error or ''}")
	tell(_("Keep Each Invoice Line in the Ledger stopped working ({0})").format(nowdate()), message)


def working_again():
	since = frappe.db.get_single_value("Accounts Settings", STOPPED)
	if not since:
		return
	missed = cint(frappe.db.get_single_value("Accounts Settings", MISSED))
	frappe.db.set_single_value("Accounts Settings", {STOPPED: None, MISSED: 0})
	message = _(
		"Keep Each Invoice Line in the Ledger works again. {0} invoices posted since {1} have their lines "
		"added up: Repost Accounting Ledger splits them (nexlify_core.overrides.invoice_lines.not_split_since)."
	).format(missed, since)
	frappe.log_error(title="Keep Each Invoice Line in the Ledger works again", message=message)
	tell(_("Keep Each Invoice Line in the Ledger works again"), message)


def tell(subject, message):
	"""A bell notification to the people with the System Manager role (one a day per subject)."""
	from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
	from frappe.utils.user import get_users_with_role

	users = [u for u in get_users_with_role("System Manager") if u not in ("Administrator", "Guest")]
	if not users:
		return
	enqueue_create_notification(
		users,
		{
			"type": "Alert",
			"subject": subject,
			"email_content": message,
			"document_type": "Accounts Settings",
			"document_name": "Accounts Settings",
		},
		dedupe_on=["subject"],
	)


def not_split_since(since):
	"""The posted invoices since a time whose lines were added up (to give to Repost Accounting Ledger)."""
	found = []
	for doctype, item_doctype in INVOICES.items():
		for name in frappe.get_all(
			doctype, filters={"docstatus": 1, "modified": (">=", since)}, pluck="name", order_by="posting_date"
		):
			lines = frappe.get_all(item_doctype, filters={"parent": name, "base_net_amount": ("!=", 0)}, pluck="name")
			if lines and not frappe.db.exists(
				"GL Entry", {"voucher_no": name, "voucher_detail_no": ("in", lines), "is_cancelled": 0}
			):
				found.append((doctype, name))
	return found


def make_setting_field():
	"""The setting's check on Accounts Settings, unticked (after migrate; changes nothing until ticked)."""
	create_custom_fields(
		{
			"Accounts Settings": [
				{
					"fieldname": SETTING,
					"fieldtype": "Check",
					"label": "Keep Each Invoice Line in the Ledger",
					"insert_after": "merge_similar_account_heads",
					"default": "0",
					"description": "Each line of a sales or purchase invoice gets a General Ledger row of its own, "
					"with the line's description, instead of lines with the same account being added up. "
					"For invoices posted after it is ticked.",
				},
				{
					"fieldname": STOPPED,
					"fieldtype": "Datetime",
					"label": "Keep Each Invoice Line: Not Working Since",
					"insert_after": SETTING,
					"read_only": 1,
					"bold": 1,
					"depends_on": f"eval:doc.{SETTING} && doc.{STOPPED}",
					"description": "Invoices posted since then have their lines added up (see the Error Log). "
					"It goes by itself once it works again.",
				},
				{
					"fieldname": MISSED,
					"fieldtype": "Int",
					"label": "Invoices Posted Added Up",
					"insert_after": STOPPED,
					"read_only": 1,
					"depends_on": f"eval:doc.{SETTING} && doc.{STOPPED}",
				},
			]
		},
		update=True,
	)
