import frappe
from nexlify_core.dashboard_filter_injector import (
	get_active_filter_rows,
	inject_number_card,
	inject_dashboard_chart,
)


def get_dashboard_card_and_chart_names(dashboard_names):
	"""Fetch all card/chart names linked to the given dashboards in bulk (single query each)."""
	card_names = set()
	chart_names = set()

	if not dashboard_names:
		return card_names, chart_names

	cards = frappe.get_all(
		"Number Card Link", filters={"parent": ["in", dashboard_names]}, pluck="card"
	)
	charts = frappe.get_all(
		"Dashboard Chart Link", filters={"parent": ["in", dashboard_names]}, pluck="chart"
	)
	card_names.update(cards)
	chart_names.update(charts)
	return card_names, chart_names


def run():
	rows = get_active_filter_rows()
	if not rows:
		print("No config found yet - add rows to Nexlify Dashboard Filter first")
		return

	# Rows scoped to a specific dashboard only affect cards/charts on that dashboard.
	# Rows with no dashboard set apply everywhere, so in that case we just sweep
	# every Number Card / Dashboard Chart in the system.
	scoped_rows = [r for r in rows if r.dashboard]
	global_rows = [r for r in rows if not r.dashboard]

	if global_rows:
		for card in frappe.get_all("Number Card", fields=["name", "document_type", "dynamic_filters_json"]):
			doc = frappe.get_doc("Number Card", card.name)
			if inject_number_card(doc, rows=global_rows):
				print(f"Updated Card: {card.name}")
		for chart in frappe.get_all("Dashboard Chart", fields=["name"]):
			doc = frappe.get_doc("Dashboard Chart", chart.name)
			if inject_dashboard_chart(doc, rows=global_rows):
				print(f"Updated Chart: {chart.name}")

	if scoped_rows:
		by_dashboard = {}
		for row in scoped_rows:
			by_dashboard.setdefault(row.dashboard, []).append(row)

		for dashboard_name, dash_rows in by_dashboard.items():
			card_names, chart_names = get_dashboard_card_and_chart_names([dashboard_name])
			for name in card_names:
				doc = frappe.get_doc("Number Card", name)
				if inject_number_card(doc, rows=dash_rows):
					print(f"Updated Card: {name} ({dashboard_name})")
			for name in chart_names:
				doc = frappe.get_doc("Dashboard Chart", name)
				if inject_dashboard_chart(doc, rows=dash_rows):
					print(f"Updated Chart: {name} ({dashboard_name})")

	frappe.db.commit()
	print("Done")
