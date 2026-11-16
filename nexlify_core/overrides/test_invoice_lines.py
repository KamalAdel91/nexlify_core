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


class NewBase:
	"""An ERPNext that passes one more argument than today's."""

	def get(self, key):
		return None

	def get_gl_dict(self, args, account_currency=None, item=None, new_argument=None):
		return frappe._dict(args, new_argument=new_argument)


class NewInvoice(invoice_lines.InvoiceLinesMixin, NewBase):
	pass


class TestInvoiceLinesGuard(IntegrationTestCase):
	def test_the_line_is_found_however_erpnext_passes_it(self):
		with patch.object(invoice_lines, "keep_lines", return_value=True):
			row = Invoice().get_gl_dict({"account": "Sales"}, "SAR", LINE)
			self.assertEqual(row.voucher_detail_no, "row-1")
			# an argument ERPNext adds later is passed on as it came
			row = NewInvoice().get_gl_dict({"account": "Sales"}, item=LINE, new_argument="kept")
			self.assertEqual((row.voucher_detail_no, row.new_argument), ("row-1", "kept"))

	def test_a_failure_never_stops_the_posting(self):
		with patch.object(invoice_lines, "with_line", side_effect=Exception("ERPNext changed")):
			row = Invoice().get_gl_dict({"account": "Sales"}, item=LINE)
		self.assertEqual(row.account, "Sales")
		self.assertIsNone(row.get("voucher_detail_no"))
		self.assertIn("ERPNext changed", frappe.flags.pop("nexlify_invoice_lines_error"))


def two_line_invoice(test):
	"""A sales invoice of two lines on the same income account, ready to post; skips on a site without the
	data to make one."""
	company = frappe.db.get_value(
		"Company",
		{"default_income_account": ("is", "set"), "default_receivable_account": ("is", "set"), "cost_center": ("is", "set")},
		["name", "default_currency"],
		as_dict=True,
	)
	customer = company and frappe.db.get_value("Customer", {"disabled": 0, "default_currency": ("in", ("", None, company.default_currency))})
	year = frappe.db.get_value("Fiscal Year", {"year_start_date": ("<=", frappe.utils.nowdate()), "year_end_date": (">=", frappe.utils.nowdate())})
	if not (company and customer and year):
		test.skipTest("no company, customer and fiscal year to post an invoice on this site")
	item = "_Test Invoice Lines Item"
	if not frappe.db.exists("Item", item):
		frappe.get_doc(
			{"doctype": "Item", "item_code": item, "item_group": frappe.db.get_value("Item Group", {"is_group": 0}), "is_stock_item": 0, "stock_uom": "Nos"}
		).insert()
	invoice = frappe.new_doc("Sales Invoice")
	invoice.update({"company": company.name, "customer": customer, "currency": company.default_currency, "conversion_rate": 1})
	for words, rate in (("Panel repair", 100), ("Cable change", 50)):
		invoice.append("items", {"item_code": item, "description": words, "qty": 1, "rate": rate})
	invoice.set_missing_values()
	invoice.taxes = []
	return invoice


class TestInvoiceLinesPosted(IntegrationTestCase):
	def setUp(self):
		invoice_lines.make_setting_field()
		frappe.db.set_single_value(
			"Accounts Settings", {invoice_lines.SETTING: 1, invoice_lines.STOPPED: None, invoice_lines.MISSED: 0}
		)
		frappe.cache.delete_value(f"nexlify_core:invoice_lines_told:{frappe.utils.nowdate()}")

	def income_rows(self, invoice):
		return frappe.get_all(
			"GL Entry",
			filters={"voucher_no": invoice.name, "is_cancelled": 0, "credit": (">", 0)},
			fields=["voucher_detail_no", "remarks", "credit"],
			order_by="credit desc",
		)

	def test_each_line_of_a_posted_invoice_has_its_own_row(self):
		invoice = two_line_invoice(self)
		invoice.insert()
		invoice.submit()
		rows = self.income_rows(invoice)
		self.assertEqual([(r.remarks, r.credit) for r in rows], [("Panel repair", 100), ("Cable change", 50)])
		self.assertIsNone(invoice_lines.stopped_since())

	def test_when_it_stops_working_the_site_is_told_and_the_note_goes_once_it_works_again(self):
		users = [u for u in frappe.utils.user.get_users_with_role("System Manager") if u not in ("Administrator", "Guest")]
		# an ERPNext that no longer passes the line: the invoice is posted the usual way
		with patch.object(invoice_lines, "line_of", return_value=None):
			invoice = two_line_invoice(self)
			invoice.insert()
			invoice.submit()
		self.assertEqual([r.credit for r in self.income_rows(invoice)], [150])
		self.assertTrue(invoice_lines.stopped_since())
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", invoice_lines.MISSED), 1)
		self.assertTrue(frappe.db.exists("Error Log", {"method": invoice_lines.ERROR_TITLE}))
		if users:
			self.assertTrue(
				frappe.db.exists("Notification Log", {"for_user": users[0], "subject": ("like", "%stopped working%")})
			)
		self.assertIn((invoice.doctype, invoice.name), invoice_lines.not_split_since(frappe.utils.add_days(frappe.utils.nowdate(), -1)))
		# fixed: the next invoice posted with its lines apart takes the note away
		again = two_line_invoice(self)
		again.insert()
		again.submit()
		self.assertIsNone(invoice_lines.stopped_since())
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", invoice_lines.MISSED), 0)
