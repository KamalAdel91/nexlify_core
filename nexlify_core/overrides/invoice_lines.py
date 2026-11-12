"""Each invoice line its own row in the General Ledger.

ERPNext adds up a sales or purchase invoice's lines that share an account, cost center, project and
dimensions into one General Ledger row. With Accounts Settings > Keep Each Invoice Line in the Ledger
ticked, every line keeps a row of its own: the row carries the line's id (voucher_detail_no, which
ERPNext keeps rows apart by) and the line's description. Unticked, ERPNext posts as it always does.
It applies to invoices posted after it is ticked; posted ones keep their rows until they are posted
again (Repost Accounting Ledger).
"""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, strip_html

SETTING = "keep_invoice_lines_in_ledger"
LINE_DOCTYPES = ("Sales Invoice Item", "Purchase Invoice Item")


def keep_lines():
	if not frappe.get_meta("Accounts Settings").has_field(SETTING):
		return False
	return cint(frappe.db.get_single_value("Accounts Settings", SETTING))


def line_remark(item):
	"""The line's own words for its ledger row: its description, else its item name."""
	text = strip_html(item.get("description") or "").strip() or (item.get("item_name") or "").strip()
	return text[:500] or None


class InvoiceLinesMixin:
	def get_gl_dict(self, args, account_currency=None, item=None):
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
				args.remarks = line_remark(item) or self.get("remarks")
		return super().get_gl_dict(args, account_currency, item)


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
				}
			]
		},
		update=True,
	)
