"""Keep Each Line in the Ledger: a row made from a document's line carries the line's id and words, only
while ticked, for any document."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from nexlify_core.overrides import ledger_lines

STOCK_ROW = {"account": "Cost of Goods Sold", "remarks": "Accounting Entry for Stock"}


class Doc:
	"""A document as ERPNext's get_gl_dict treats it: the row is made, the hook runs, then args are laid over."""

	doctype = "Delivery Note"
	name = "DN-1"
	remarks = None

	def __init__(self, *lines):
		self.items = list(lines)

	def get(self, key, default=None):
		return getattr(self, key, default)

	def get_gl_dict(self, args, account_currency=None, item=None):
		gl_dict = frappe._dict(remarks=self.remarks, voucher_detail_no=args.get("voucher_detail_no"))
		update_gl_dict_with_app_based_fields(self, gl_dict)
		gl_dict.update(args)
		return gl_dict


def update_gl_dict_with_app_based_fields(doc, gl_dict):
	ledger_lines.tag_row(doc, gl_dict)


def line(name="row-1", parent="DN-1", **fields):
	return frappe._dict(doctype="Delivery Note Item", parenttype="Delivery Note", parent=parent, name=name, **fields)


def ticked(value=True):
	return patch.object(ledger_lines, "keep_lines", return_value=value)


class TestLedgerLines(IntegrationTestCase):
	def test_a_line_keeps_its_own_row_and_words_only_while_ticked(self):
		panel = line(description="<p>Panel repair</p>", item_name="Repair")
		with ticked():
			row = Doc(panel).get_gl_dict(STOCK_ROW, item=panel)
		self.assertEqual((row.voucher_detail_no, row[ledger_lines.WORDS]), ("row-1", "Panel repair"))
		gle = frappe.new_doc("GL Entry")
		gle.update(row)
		ledger_lines.put_line_words(gle)
		self.assertEqual(gle.remarks, "Panel repair")
		with ticked(False):
			row = Doc(panel).get_gl_dict(STOCK_ROW, item=panel)
		self.assertIsNone(row.voucher_detail_no)
		self.assertNotIn(ledger_lines.WORDS, row)

	def test_rows_erpnext_ties_itself_and_party_rows_are_left_alone(self):
		panel = line(description="Panel repair")
		doc = Doc(panel)
		with ticked():
			rows = [
				doc.get_gl_dict({"account": "Debtors", "party_type": "Customer", "party": "C1"}, item=panel),
				# a Journal Entry passes its own voucher_detail_no, empty or not
				doc.get_gl_dict({"account": "Bank", "voucher_detail_no": None}, item=panel),
				doc.get_gl_dict({"account": "Payable"}, item=doc),
				doc.get_gl_dict({"account": "Stock"}, item=line(parent="DN-2")),
				doc.get_gl_dict({"account": "Stock"}),
			]
		self.assertEqual([r.voucher_detail_no for r in rows], [None] * 5)

	def test_a_plain_record_stands_for_the_documents_line(self):
		stent = line(name="r-9", item_name="Stent")
		with ticked():
			row = Doc(stent).get_gl_dict(STOCK_ROW, item=frappe._dict(name="r-9", expense_account="Adjustment"))
		self.assertEqual((row.voucher_detail_no, row[ledger_lines.WORDS]), ("r-9", "Stent"))

	def test_a_rows_own_words_are_kept(self):
		panel = line(description="Panel repair")
		with ticked():
			row = Doc(panel).get_gl_dict({"account": "Freight", "remarks": "Landed cost of PR-1"}, item=panel)
		self.assertEqual(row.voucher_detail_no, "row-1")
		self.assertIsNone(row.get(ledger_lines.WORDS))

	def test_a_failure_never_stops_the_posting(self):
		panel = line(description="Panel repair")
		with ticked(), patch.object(ledger_lines, "gl_dict_call", side_effect=Exception("ERPNext changed")):
			row = Doc(panel).get_gl_dict(STOCK_ROW, item=panel)
		self.assertEqual((row.account, row.voucher_detail_no), ("Cost of Goods Sold", None))
		self.assertIn("ERPNext changed", frappe.flags.pop(ledger_lines.ERROR_FLAG))
		# the hook called from somewhere other than get_gl_dict: told, never stopped
		with ticked():
			ledger_lines.tag_row(Doc(), frappe._dict())
		self.assertIn("LookupError", frappe.flags.pop(ledger_lines.ERROR_FLAG))

	def test_the_setting_is_a_check_unticked_on_accounts_settings(self):
		ledger_lines.make_setting_field()
		field = frappe.get_meta("Accounts Settings").get_field(ledger_lines.SETTING)
		self.assertEqual((field.fieldtype, field.default), ("Check", "0"))


def company_and_customer(test):
	company = frappe.db.get_value(
		"Company",
		{"default_income_account": ("is", "set"), "default_receivable_account": ("is", "set"), "cost_center": ("is", "set")},
		["name", "default_currency", "default_income_account"],
		as_dict=True,
	)
	customer = company and frappe.db.get_value("Customer", {"disabled": 0, "default_currency": ("in", ("", None, company.default_currency))})
	year = frappe.db.get_value("Fiscal Year", {"year_start_date": ("<=", frappe.utils.nowdate()), "year_end_date": (">=", frappe.utils.nowdate())})
	if not (company and customer and year):
		test.skipTest("no company, customer and fiscal year to post an invoice on this site")
	return company, customer


def two_line_document(test, doctype="Sales Invoice"):
	"""A document of two lines on the same account, ready to post; skips on a site without the data."""
	company, customer = company_and_customer(test)
	item = "_Test Invoice Lines Item"
	if not frappe.db.exists("Item", item):
		frappe.get_doc(
			{"doctype": "Item", "item_code": item, "item_group": frappe.db.get_value("Item Group", {"is_group": 0}), "is_stock_item": 0, "stock_uom": "Nos"}
		).insert()
	doc = frappe.new_doc(doctype)
	doc.update({"company": company.name, "customer": customer, "currency": company.default_currency, "conversion_rate": 1})
	for words, rate in (("Panel repair", 100), ("Cable change", 50)):
		doc.append("items", {"item_code": item, "description": words, "qty": 1, "rate": rate})
	doc.set_missing_values()
	doc.taxes = []
	return doc


class TestLedgerLinesInErpnext(IntegrationTestCase):
	"""ERPNext's own get_gl_dict, of an invoice and of a stock document, calls the hook with the line."""

	def test_erpnext_rows_of_any_document_keep_their_line(self):
		for doctype in ("Sales Invoice", "Delivery Note"):
			doc = two_line_document(self, doctype)
			doc.name = f"_TEST-{doctype}"
			for row in doc.items:
				row.update({"name": frappe.generate_hash(length=10), "parent": doc.name})
			account = frappe.db.get_value("Company", doc.company, "default_income_account")
			with ticked():
				row = doc.get_gl_dict(
					{"account": account, "credit": 100, "remarks": frappe._("Accounting Entry for Stock")},
					doc.currency,
					item=doc.items[0],
				)
			self.assertEqual((row.voucher_detail_no, row.get(ledger_lines.WORDS)), (doc.items[0].name, "Panel repair"), doctype)
			self.assertIsNone(frappe.flags.pop(ledger_lines.ERROR_FLAG, None), doctype)


class TestLedgerLinesPosted(IntegrationTestCase):
	def setUp(self):
		ledger_lines.make_setting_field()
		frappe.db.set_single_value(
			"Accounts Settings", {ledger_lines.SETTING: 1, ledger_lines.STOPPED: None, ledger_lines.MISSED: 0}
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
		invoice = two_line_document(self)
		invoice.insert()
		invoice.submit()
		rows = self.income_rows(invoice)
		self.assertEqual([(r.remarks, r.credit) for r in rows], [("Panel repair", 100), ("Cable change", 50)])
		self.assertIsNone(ledger_lines.stopped_since())

	def test_when_it_stops_working_the_site_is_told_and_the_note_goes_once_it_works_again(self):
		users = [u for u in frappe.utils.user.get_users_with_role("System Manager") if u not in ("Administrator", "Guest")]
		# an ERPNext that no longer passes the line: the invoice is posted the usual way
		with patch.object(ledger_lines, "line_of", return_value=None):
			invoice = two_line_document(self)
			invoice.insert()
			invoice.submit()
		self.assertEqual([r.credit for r in self.income_rows(invoice)], [150])
		self.assertTrue(ledger_lines.stopped_since())
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", ledger_lines.MISSED), 1)
		self.assertTrue(frappe.db.exists("Error Log", {"method": ledger_lines.ERROR_TITLE}))
		if users:
			self.assertTrue(
				frappe.db.exists("Notification Log", {"for_user": users[0], "subject": ("like", "%stopped working%")})
			)
		self.assertIn((invoice.doctype, invoice.name), ledger_lines.not_split_since(frappe.utils.add_days(frappe.utils.nowdate(), -1)))
		# fixed: the next invoice posted with its lines apart takes the note away
		again = two_line_document(self)
		again.insert()
		again.submit()
		self.assertIsNone(ledger_lines.stopped_since())
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", ledger_lines.MISSED), 0)
