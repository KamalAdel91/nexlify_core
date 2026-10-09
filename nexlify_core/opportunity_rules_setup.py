import frappe

DT = "Opportunity"
LOST_HAS = "{!r} in [r.get('lost_reason') for r in (doc.get('lost_reasons') or [])]"
RULES = [
	("Closed Won", "Required Information for Closed Won.", [
		("custom_closing_date", ""), ("opportunity_amount", ""), ("custom_region", ""), ("custom_signed_contract", "")]),
	("Closed Lost", "Lost Reason Required.", [
		("lost_reasons", ""), ("competitors", LOST_HAS.format("Competition")), ("order_lost_reason", LOST_HAS.format("Other"))]),
]
SCRIPT_NAME = "Opportunity - Stage Rules"
SCRIPT = """if doc.has_value_changed("sales_stage"):
    if doc.sales_stage == "Closed Won":
        if doc.custom_estimation_status != "Sent to Sales":
            frappe.throw(
                "The Opportunity can be Closed Won only after its Estimation is sent to Sales. Estimation Status: "
                + (doc.custom_estimation_status or "Not Sent"),
                title="Estimation Required",
            )
        doc.status = "Closed"
    elif doc.sales_stage == "Closed Lost":
        doc.status = "Lost"
"""


def run():
	for to, message, fields in RULES:
		if frappe.db.exists("Transition Rule", {"reference_doctype": DT, "stage_field": "sales_stage", "to_value": to}):
			print(f"Transition Rule to {to}: exists")
			continue
		rule = frappe.get_doc({
			"doctype": "Transition Rule",
			"reference_doctype": DT,
			"stage_field": "sales_stage",
			"to_value": to,
			"message": message,
			"required_fields": [{"fieldname": f, "condition": c} for f, c in fields],
		}).insert(ignore_permissions=True)
		print(f"Transition Rule to {to}: {rule.name}")

	if frappe.db.exists("Server Script", SCRIPT_NAME):
		print(f"Server Script {SCRIPT_NAME}: exists")
	else:
		frappe.get_doc({
			"doctype": "Server Script",
			"script_type": "DocType Event",
			"reference_doctype": DT,
			"doctype_event": "Before Save",
			"script": SCRIPT,
		}).insert(ignore_permissions=True, set_name=SCRIPT_NAME)
		print(f"Server Script {SCRIPT_NAME}: created")
	frappe.db.commit()
