"""Keep Each Invoice Line in the Ledger: a line's row carries its id and words only while ticked."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from nexlify_core.overrides import invoice_lines


class Base:
	def get(self, key):
		return {"remarks": "The invoice's remarks"}.get(key)

	def get_gl_dict(self, args, account_currency=None, item=None):
		return frappe._dict(args)


class Invoice(invoice_lines.InvoiceLinesMixin, Base):
	pass


LINE = frappe._dict(doctype="Sales Invoice Item", name="row-1", description="<p>Panel repair</p>", item_name="Repair")


class TestInvoiceLines(IntegrationTestCase):
	def test_a_line_keeps_its_own_row_only_while_ticked(self):
		with patch.object(invoice_lines, "keep_lines", return_value=True):
			row = Invoice().get_gl_dict({"account": "Sales"}, item=LINE)
			self.assertEqual((row.voucher_detail_no, row.remarks), ("row-1", "Panel repair"))
			# a row that is not an invoice line (the party's, a tax's) is left as ERPNext makes it
			tax = Invoice().get_gl_dict({"account": "VAT"}, item=frappe._dict(doctype="Sales Taxes and Charges", name="t"))
			self.assertIsNone(tax.get("voucher_detail_no"))
		with patch.object(invoice_lines, "keep_lines", return_value=False):
			row = Invoice().get_gl_dict({"account": "Sales"}, item=LINE)
			self.assertIsNone(row.get("voucher_detail_no"))

	def test_the_setting_is_a_check_unticked_on_accounts_settings(self):
		invoice_lines.make_setting_field()
		field = frappe.get_meta("Accounts Settings").get_field(invoice_lines.SETTING)
		self.assertEqual((field.fieldtype, field.default), ("Check", "0"))
