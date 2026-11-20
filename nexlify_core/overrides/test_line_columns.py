"""Keep Each Line in the Ledger, in reports: a ledger row's document line gives its fields, while ticked."""

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from nexlify_core.overrides import ledger_lines, line_columns
from nexlify_core.overrides.test_ledger_lines import two_line_document


class TestLineColumns(IntegrationTestCase):
	def setUp(self):
		ledger_lines.make_setting_field()
		frappe.db.set_single_value("Accounts Settings", {ledger_lines.SETTING: 1, ledger_lines.STOPPED: None, ledger_lines.MISSED: 0})

	def posted_invoice(self):
		invoice = two_line_document(self)
		invoice.insert()
		invoice.submit()
		rows = frappe.get_all(
			"GL Entry",
			filters={"voucher_no": invoice.name, "is_cancelled": 0, "credit": (">", 0)},
			fields=["name", "credit", "voucher_detail_no"],
			order_by="credit desc",
		)
		return invoice, rows

	def test_each_ledger_row_gives_its_lines_field(self):
		invoice, rows = self.posted_invoice()
		got = line_columns.line_values("GL Entry", [r.name for r in rows], "description", ["credit", "account"])
		self.assertEqual([got["values"][r.name] for r in rows], ["Panel repair", "Cable change"])
		# only number fields are compared
		self.assertEqual(got["amounts"][rows[0].name], {"credit": 100})

	def test_the_choices_are_the_ledger_tables_and_their_lines_fields(self):
		self.posted_invoice()
		choices = line_columns.line_choices(["GL Entry", "Account", "Sales Invoice"])
		self.assertEqual(list(choices), ["GL Entry"])
		fields = {f["field"] for f in choices["GL Entry"]}
		self.assertTrue({"item_code", "qty", "description"} <= fields)
		self.assertNotIn("items", fields)

	def test_nothing_while_unticked(self):
		invoice, rows = self.posted_invoice()
		with patch.object(line_columns, "keep_lines", return_value=False):
			self.assertEqual(line_columns.line_choices(["GL Entry"]), {})
			self.assertEqual(line_columns.line_fields("GL Entry"), [])
			self.assertEqual(line_columns.line_values("GL Entry", [rows[0].name], "item_code")["values"], {})

	def test_a_table_without_lines_is_refused(self):
		with self.assertRaises(frappe.PermissionError):
			line_columns.line_values("Account", ["x"], "account_name")


class TestLineColumnsExport(IntegrationTestCase):
	def setUp(self):
		ledger_lines.make_setting_field()
		frappe.db.set_single_value("Accounts Settings", {ledger_lines.SETTING: 1, ledger_lines.STOPPED: None, ledger_lines.MISSED: 0})

	def fill(self, columns, result):
		from frappe.desk import query_report

		from nexlify_core.overrides import line_columns_export

		with line_columns_export.columns_filled():
			found = query_report.get_data_for_custom_report(columns, result)
		# Frappe's own filling is back after the export
		self.assertEqual(query_report.get_data_for_custom_report.__module__, "frappe.desk.query_report")
		return found

	def test_the_export_fills_line_columns_and_leaves_a_row_of_several_empty(self):
		invoice, rows = TestLineColumns.posted_invoice(self)
		column = {"fieldname": "nxline_description_gl_entry", "doctype": "GL Entry", "link_field": {"fieldname": "gl_entry"}, "nexlify_added": {"field": "description", "line": 1}}
		result = [
			{"gl_entry": rows[0].name, "credit": 100},
			# a row of the report adding up both lines: its amount is not its ledger row's own
			{"gl_entry": rows[1].name, "credit": 150},
		]
		found = self.fill([column], result)
		self.assertEqual(found[("GL Entry", column["fieldname"])], {rows[0].name: "Panel repair", rows[1].name: None})

	def test_the_export_fills_a_linked_documents_field_of_the_views_own(self):
		invoice, rows = TestLineColumns.posted_invoice(self)
		column = {
			"fieldname": "nxlink_sales_invoice_customer_voucher_no",
			"doctype": "Sales Invoice",
			"link_field": {"fieldname": "voucher_no"},
			"nexlify_added": {"field": "customer", "line": 0, "dynamic": "voucher_type"},
		}
		result = [{"voucher_no": invoice.name, "voucher_type": "Sales Invoice"}, {"voucher_no": "PE-X", "voucher_type": "Payment Entry"}]
		found = self.fill([column], result)
		self.assertEqual(found[("Sales Invoice", column["fieldname"])], {invoice.name: invoice.customer})
