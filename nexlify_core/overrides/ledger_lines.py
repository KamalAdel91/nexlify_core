"""Each line its own row in the General Ledger, for every document that posts to it.

ERPNext adds up the General Ledger rows of a document's lines that share an account, cost center, project
and dimensions. With Accounts Settings > Keep Each Line in the Ledger ticked, every row ERPNext makes from a
line keeps a row of its own, whatever the document (invoices, delivery notes, purchase receipts, stock
entries, stock reconciliations, expense claims, asset documents, other apps' documents): the row carries the
line's id (voucher_detail_no, which ERPNext keeps rows apart by) and the line's words. Unticked, ERPNext
posts as it always does. It applies to documents posted after it is ticked; posted ones keep their rows
until they are posted again (Repost Accounting Ledger, Repost Item Valuation).

Left as ERPNext makes them: a party's rows (customer, supplier, employee), and rows ERPNext ties to a line or
a reference itself (Journal Entry and Payment Entry rows: Merge Similar Account Heads unticked keeps those
apart).

How: ERPNext builds every ledger row in AccountsController.get_gl_dict(args, account_currency, item) and
calls the update_gl_dict_with_app_based_fields hook from there; tag_row() reads the line (item) from that
call. ERPNext lays its own remark over the row after the hook, so the line's words ride on the row and are
put in when the row is saved (GL Entry before_insert).

It never stops a posting. An ERPNext update may change how rows are built: then documents are posted the
usual way (lines added up), and the people with the System Manager role are told the same day (a bell
notification, an Error Log, "Not working since" on Accounts Settings). Sales and purchase invoices are the
check: each one posted must have its lines apart. Once it works again the note on Accounts Settings goes
by itself; the invoices posted between are found by not_split_since().
"""

import sys

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, now_datetime, nowdate, strip_html

SETTING = "keep_invoice_lines_in_ledger"
# when it stopped working (empty while it works), and how many invoices were posted the usual way since
STOPPED = "keep_invoice_lines_stopped_since"
MISSED = "keep_invoice_lines_missed"
INVOICES = {"Sales Invoice": "Sales Invoice Item", "Purchase Invoice": "Purchase Invoice Item"}
ERROR_TITLE = "Keep Each Line in the Ledger stopped working"
ERROR_FLAG = "nexlify_ledger_lines_error"
# the line's words, carried on the row from get_gl_dict to the saved GL Entry
WORDS = "nexlify_line_words"


def keep_lines():
	if not frappe.get_meta("Accounts Settings").has_field(SETTING):
		return False
	return cint(frappe.db.get_single_value("Accounts Settings", SETTING))


def tag_row(doc, gl_dict):
	"""Hook update_gl_dict_with_app_based_fields: a row made from one of the document's lines keeps that
	line's id, and its words for when the row is saved. Never stops the posting."""
	try:
		if not keep_lines():
			return
		args, item = gl_dict_call(doc)
		line = line_of(doc, item)
		# ERPNext ties a row to a line itself by giving it a voucher_detail_no; an empty one (a Sales
		# Invoice's income rows since ERPNext 16.60) ties it to nothing, so the row takes its line
		if line is None or args.get("party") or args.get("voucher_detail_no"):
			return
		gl_dict.voucher_detail_no = line.name
		if plain_remark(doc, args):
			gl_dict[WORDS] = line_words(line)
	except Exception:
		frappe.flags[ERROR_FLAG] = frappe.get_traceback()


def put_line_words(gle, method=None):
	"""GL Entry before_insert: a line's row gets the line's words in place of the document's remark."""
	words = gle.get(WORDS)
	if words and gle.voucher_detail_no:
		gle.remarks = words


def gl_dict_call(doc):
	"""The args and item of ERPNext's get_gl_dict(args, account_currency, item) call running the hook."""
	frame = sys._getframe(1)
	while frame is not None:
		if frame.f_code.co_name == "get_gl_dict" and frame.f_locals.get("self") is doc:
			names = frame.f_locals
			if "args" not in names or "item" not in names:
				raise LookupError("ERPNext's get_gl_dict no longer has args and item")
			return names["args"] or {}, names["item"]
		frame = frame.f_back
	raise LookupError("update_gl_dict_with_app_based_fields was not called from ERPNext's get_gl_dict")


def line_of(doc, item):
	"""The document's own line the row is made from; None for no line, the document itself, or a line
	of another document."""
	if item is None or item is doc or not item.get("name"):
		return None
	if item.get("doctype"):
		mine = item.get("parent") == doc.name and item.get("parenttype") == doc.doctype
		return item if mine else None
	# a plain record standing for a line (Stock Reconciliation): the document's row of that name
	return next((row for row in doc.get("items") or [] if row.name == item.get("name")), None)


def plain_remark(doc, args):
	"""The row would carry the document's remark or ERPNext's general stock words (not words of its own)."""
	remark = args.get("remarks")
	general = {doc.get("remarks"), doc.get("remark"), _("Accounting Entry for Stock"), _("Accounting Entry for Service")}
	return not remark or remark in general


def line_words(line):
	"""The line's description, else its item name or its own remark."""
	for field in ("description", "item_name", "user_remark", "remarks"):
		text = strip_html(line.get(field) or "").strip()
		if text:
			return text[:500]
	return None


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
			stopped(doc, frappe.flags.pop(ERROR_FLAG, None))
	except Exception:
		frappe.log_error(title=ERROR_TITLE, message=frappe.get_traceback())


def stopped_since():
	"""When it stopped working, or None while it works (an empty Datetime reads back as the year 1)."""
	value = frappe.db.get_single_value("Accounts Settings", STOPPED)
	return value if value and getattr(value, "year", 1) > 1 else None


def stopped(doc, error=None):
	"""It did not work for this invoice: counted on Accounts Settings, and told once a day."""
	since = stopped_since()
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
		"{0} {1} was posted with its lines added up: Keep Each Line in the Ledger stopped working "
		"(most likely after an ERPNext update). Documents are posted the usual way until it is fixed."
	).format(_(doc.doctype), doc.name)
	frappe.log_error(title=ERROR_TITLE, message=f"{message}\n\n{error or ''}")
	tell(_("Keep Each Line in the Ledger stopped working ({0})").format(nowdate()), message)


def working_again():
	since = stopped_since()
	if not since:
		return
	missed = cint(frappe.db.get_single_value("Accounts Settings", MISSED))
	frappe.db.set_single_value("Accounts Settings", {STOPPED: None, MISSED: 0})
	message = _(
		"Keep Each Line in the Ledger works again. {0} invoices (and any other documents) posted since {1} "
		"have their lines added up: posting them again splits them (Repost Accounting Ledger; "
		"nexlify_core.overrides.ledger_lines.not_split_since lists the invoices)."
	).format(missed, since)
	frappe.log_error(title="Keep Each Line in the Ledger works again", message=message)
	tell(_("Keep Each Line in the Ledger works again"), message)


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
					"label": "Keep Each Line in the Ledger",
					"insert_after": "merge_similar_account_heads",
					"default": "0",
					"description": "Every General Ledger row made from a document's line (invoices, delivery notes, "
					"purchase receipts, stock entries, expense claims and any other document) gets a row of its own "
					"with the line's words, instead of being added up with the other lines on the same account. "
					"Customer, supplier and employee rows stay as they are; Journal and Payment Entries follow "
					"Merge Similar Account Heads. For documents posted after it is ticked.",
				},
				{
					"fieldname": STOPPED,
					"fieldtype": "Datetime",
					"label": "Keep Each Line: Not Working Since",
					"insert_after": SETTING,
					"read_only": 1,
					"bold": 1,
					"depends_on": f"eval:doc.{SETTING} && doc.{STOPPED}",
					"description": "Documents posted since then have their lines added up (see the Error Log). "
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
