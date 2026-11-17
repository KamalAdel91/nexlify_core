"""Nexlify Report View: review marks, layouts and the export of the table as shown.

Every call runs as the user. The report must be one they may run (Frappe's own
check), and the records follow the DocTypes' permissions and the hooks below.
"""

import json
import re

import frappe
from frappe import _
from frappe.desk.desk_views import DeskViews

REVIEW = "Nexlify Report Review"
LAYOUT = "Nexlify Report Layout"
STATUSES = ("Reviewed", "Needs Support")
MAX_REVIEW_ITEMS = 500
MAX_NOTE = 2000
MAX_FILTERS_TEXT = 10_000
MAX_LAYOUT_STATE = 200_000


def check_report(report: str) -> None:
	"""Frappe's own check for running a report: report roles, the report permission
	on its DocType, and the report not being disabled."""
	if not isinstance(report, str) or not report:
		frappe.throw(_("Report is missing"), frappe.ValidationError)
	from frappe.desk.query_report import get_report_doc

	get_report_doc(report)


def check_key(value, label: str) -> str:
	# a key must be a plain string: a filter list here would widen the query
	if not isinstance(value, str) or not value or len(value) > 140:
		frappe.throw(_("{0} is not valid").format(label), frappe.ValidationError)
	return value


# ---------------------------------------------------------------------------
# Review marks
# ---------------------------------------------------------------------------
@frappe.whitelist()
def get_reviews(report: str, filters_key: str) -> list[dict]:
	check_report(report)
	check_key(filters_key, _("Filters Key"))
	return frappe.get_list(
		REVIEW,
		filters={"report": report, "filters_key": filters_key},
		fields=["name", "row_key", "report_column", "status", "note", "owner", "modified_by", "modified"],
		limit_page_length=0,
	)


@frappe.whitelist()
def set_reviews(report: str, filters_key: str, items: str | list, filters: str | None = None) -> list[dict]:
	"""Set or clear review marks. Each item: row_key, column, row_label, status, note.
	An item with no status and no note clears the mark."""
	check_report(report)
	check_key(filters_key, _("Filters Key"))
	items = frappe.parse_json(items) or []
	if not isinstance(items, list):
		frappe.throw(_("Review marks must be a list"), frappe.ValidationError)
	if len(items) > MAX_REVIEW_ITEMS:
		frappe.throw(_("Mark at most {0} figures at a time").format(MAX_REVIEW_ITEMS), frappe.ValidationError)
	items = [frappe._dict(item) for item in items if isinstance(item, dict)]
	for item in items:
		check_key(item.row_key, _("Row Key"))
		check_key(item.column, _("Column"))
	# the same figure twice in one call: the last one counts
	items = list({(i.row_key, i.column): i for i in items}.values())

	existing = {}
	if items:
		for row in frappe.get_list(
			REVIEW,
			filters={"report": report, "filters_key": filters_key, "row_key": ["in", list({i.row_key for i in items})]},
			fields=["name", "row_key", "report_column"],
			limit_page_length=0,
		):
			existing[(row.row_key, row.report_column)] = row.name

	filters_text = (filters if isinstance(filters, str) else json.dumps(filters or {}))[:MAX_FILTERS_TEXT]
	for item in items:
		save_review(report, filters_key, item, filters_text, existing.get((item.row_key, item.column)))
	return get_reviews(report, filters_key)


def save_review(report: str, filters_key: str, item: frappe._dict, filters: str, name: str | None) -> None:
	status = item.status if item.status in STATUSES else None
	note = (item.note or "").strip()[:MAX_NOTE] if isinstance(item.note, str) else ""
	if not status and not note:
		if name:
			frappe.delete_doc(REVIEW, name)
		return
	values = {
		"status": status,
		"note": note,
		"row_label": (item.row_label or "")[:140] if isinstance(item.row_label, str) else "",
		"filters": filters,
	}
	if name:
		doc = frappe.get_doc(REVIEW, name)
		doc.update(values)
		doc.save()
		return
	doc = frappe.new_doc(REVIEW)
	doc.update({"report": report, "filters_key": filters_key, "row_key": item.row_key, "report_column": item.column, **values})
	try:
		doc.insert()
	except (frappe.DuplicateEntryError, frappe.UniqueValidationError):
		# someone marked the same figure at the same moment: update theirs
		frappe.clear_last_message()
		name = frappe.db.get_value(
			REVIEW, {"report": report, "filters_key": filters_key, "row_key": item.row_key, "report_column": item.column}
		)
		if name:
			other = frappe.get_doc(REVIEW, name)
			other.update(values)
			other.save()


def allowed_reports(user: str | None = None) -> set[str]:
	"""The reports the user may open, by the same rules as check_report (Frappe's get_report_doc):
	the report's roles, the report permission on its DocType, and the report not disabled."""
	user = user or frappe.session.user
	names = DeskViews.get_allowed_report_names(cache=True, user=user)
	allowed = set()
	for name in names:
		info = frappe.get_cached_value("Report", name, ["ref_doctype", "disabled"], as_dict=True)
		if not info or info.disabled:
			continue
		if info.ref_doctype and not frappe.has_permission(info.ref_doctype, "report", user=user):
			continue
		allowed.add(name)
	return allowed


def report_in(field: str, names: set[str]) -> str:
	if not names:
		return "1=0"
	return f"{field} in ({', '.join(frappe.db.escape(n) for n in sorted(names))})"


def stored(doc, fieldname: str):
	"""The value saved in the database, never the one a request sends: a permission is decided on it."""
	if doc.get("name") and not doc.is_new():
		value = frappe.db.get_value(doc.doctype, doc.name, fieldname)
		if value is not None:
			return value
	return doc.get(fieldname)


# A review mark is seen and changed only by users who may open its report.
def review_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	if doctype not in (None, REVIEW):
		return ""
	return report_in(f"`tab{REVIEW}`.`report`", allowed_reports(user))


def review_has_permission(doc, ptype: str | None = None, user: str | None = None, debug: bool = False) -> bool:
	if doc.doctype != REVIEW:
		return True
	allowed = allowed_reports(user)
	# both the saved report and a new one sent with the change must be ones the user may open
	return all(report in allowed for report in {stored(doc, "report"), doc.get("report")} if report)


# ---------------------------------------------------------------------------
# How a report's columns link to other tables: from the DocTypes' definitions,
# never from the rows a report shows
# ---------------------------------------------------------------------------
MAX_GUESS_COLUMNS = 60
MAX_TARGETS = 40
NEVER_LINKS = {"DocType", "Currency", "Report", "Page", "File", "User Permission"}


def readable_doctype(doctype: str) -> bool:
	if not isinstance(doctype, str) or doctype in NEVER_LINKS or not frappe.db.exists("DocType", doctype):
		return False
	meta = frappe.get_meta(doctype)
	if meta.istable or meta.issingle or meta.is_virtual:
		return False
	return bool(frappe.has_permission(doctype, "read"))


def table_fields(doctype: str) -> dict:
	"""The fields of a DocType and of its child tables, by fieldname (the parent's field wins)."""
	out = {}
	if not doctype or not frappe.db.exists("DocType", doctype):
		return out
	meta = frappe.get_meta(doctype)
	for df in meta.fields:
		out.setdefault(df.fieldname, (doctype, df))
	for table in meta.get_table_fields():
		for df in frappe.get_meta(table.options).fields:
			out.setdefault(df.fieldname, (table.options, df))
	return out


def dynamic_targets(table: str, type_df) -> list[str]:
	"""The DocTypes a Dynamic Link can point to, from its type field: the records of the table the
	type field links to (Party Type), the options of a Select, or else every type stored in that
	column of the table (all its rows, not the report's)."""
	if type_df.fieldtype == "Link" and type_df.options and type_df.options != "DocType":
		names = frappe.get_all(type_df.options, pluck="name", limit_page_length=MAX_TARGETS * 2)
	elif type_df.fieldtype == "Select":
		names = [x.strip() for x in (type_df.options or "").split("\n") if x.strip()]
	else:
		names = frappe.get_all(table, fields=[type_df.fieldname], distinct=True, pluck=type_df.fieldname, limit_page_length=MAX_TARGETS * 2)
	return [dt for dt in dict.fromkeys(names) if readable_doctype(dt)][:MAX_TARGETS]


@frappe.whitelist()
def guess_links(report: str, columns: str | list, dynamic: str | list | None = None) -> dict:
	"""How the report's columns link to other tables, read from the definition of the report's DocType
	(and its child tables): a column whose field there is a Link links to that DocType, one whose field
	is a Dynamic Link links to every DocType its type field allows.
	columns: fieldnames the report did not mark; dynamic: [fieldname, type fieldname] the report marked."""
	check_report(report)
	columns = frappe.parse_json(columns) or []
	dynamic = frappe.parse_json(dynamic) or []
	if not isinstance(columns, list) or not isinstance(dynamic, list):
		frappe.throw(_("Columns are not valid"), frappe.ValidationError)
	ref = frappe.get_cached_value("Report", report, "ref_doctype")
	fields = table_fields(ref)
	result = {}

	def targets_of(type_fieldname: str) -> list[str]:
		found = fields.get(type_fieldname)
		return dynamic_targets(found[0], found[1]) if found else []

	for fieldname in columns[:MAX_GUESS_COLUMNS]:
		if not isinstance(fieldname, str) or fieldname not in fields:
			continue
		table, df = fields[fieldname]
		if df.fieldtype == "Link" and df.options and readable_doctype(df.options):
			result[fieldname] = {"link": df.options}
		elif df.fieldtype == "Dynamic Link" and df.options:
			result[fieldname] = {"dynamic": df.options, "targets": targets_of(df.options)}
	for pair in dynamic[:MAX_GUESS_COLUMNS]:
		if not (isinstance(pair, list) and len(pair) == 2 and all(isinstance(x, str) for x in pair)):
			continue
		fieldname, type_fieldname = pair
		targets = targets_of(type_fieldname)
		if targets:
			result[fieldname] = {"dynamic": type_fieldname, "targets": targets}
	return result


# ---------------------------------------------------------------------------
# Layouts: a user sees their own layouts and the public ones, and changes only
# their own. System Managers see and change all.
# Frappe treats None from a has_permission hook as a denial: return True or False.
# ---------------------------------------------------------------------------
def is_system_manager(user: str) -> bool:
	return user == "Administrator" or "System Manager" in frappe.get_roles(user)


def layout_query_conditions(user: str | None = None, doctype: str | None = None) -> str:
	if doctype not in (None, LAYOUT):
		return ""
	user = user or frappe.session.user
	if is_system_manager(user):
		return ""
	own_or_public = f"(`tab{LAYOUT}`.`owner` = {frappe.db.escape(user)} or `tab{LAYOUT}`.`is_public` = 1)"
	return f"({own_or_public} and {report_in(f'`tab{LAYOUT}`.`report`', allowed_reports(user))})"


def layout_has_permission(doc, ptype: str | None = None, user: str | None = None, debug: bool = False) -> bool:
	if doc.doctype != LAYOUT:
		return True
	user = user or frappe.session.user
	if is_system_manager(user):
		return True
	# the owner and the report saved in the database decide, not the ones a request sends
	owner = stored(doc, "owner")
	report = stored(doc, "report")
	if report and report not in allowed_reports(user):
		return False
	if not owner or owner == user:
		return True
	return ptype == "read" and bool(stored(doc, "is_public"))


def validate_layout_state(state) -> None:
	text = state if isinstance(state, str) else json.dumps(state or {})
	if len(text) > MAX_LAYOUT_STATE:
		frappe.throw(_("This layout is too large to save"), frappe.ValidationError)
	try:
		value = json.loads(text) if text else {}
	except ValueError:
		frappe.throw(_("This layout is not valid"), frappe.ValidationError)
	if not isinstance(value, dict):
		frappe.throw(_("This layout is not valid"), frappe.ValidationError)


# ---------------------------------------------------------------------------
# Export the table as the user sees it: their columns, formats and grouping.
# The numbers stay numbers; the report's own Export permission applies.
# ---------------------------------------------------------------------------
FILLS = {"redbg": "FFE0DE", "amberbg": "FFF0D0", "greenbg": "DDF3E6", "bluebg": "E1E9FC"}
FONT_COLORS = {"red": "C2362F", "green": "18794E", "muted": "8A8F99"}
MAX_EXPORT_ROWS = 200_000


@frappe.whitelist(methods=["POST"])
def export_view(
	report: str,
	file_format: str = "xlsx",
	title: str | None = None,
	subtitle: str | None = None,
	columns: str | None = None,
	rows: str | None = None,
):
	check_report(report)
	frappe.permissions.can_export(frappe.get_cached_value("Report", report, "ref_doctype"), raise_exception=True)
	columns = frappe.parse_json(columns) or []
	rows = frappe.parse_json(rows) or []
	if not isinstance(columns, list) or not isinstance(rows, list):
		frappe.throw(_("The table to export is not valid"), frappe.ValidationError)
	if len(rows) > MAX_EXPORT_ROWS:
		frappe.throw(_("Export at most {0} rows at a time").format(MAX_EXPORT_ROWS), frappe.ValidationError)
	columns = [c if isinstance(c, dict) else {} for c in columns]
	rows = [r for r in rows if isinstance(r, dict)]
	title = (title if isinstance(title, str) and title.strip() else report).strip()[:120]
	subtitle = subtitle if isinstance(subtitle, str) else None
	if file_format == "csv":
		content = csv_content(columns, rows)
		extension = "csv"
	else:
		content = xlsx_content(title, subtitle, columns, rows)
		extension = "xlsx"
	# the file's name in the download header: no control characters, slashes or quotes
	safe = re.sub(r'[\x00-\x1f\x7f\\/:*?"<>|]+', " ", title).strip() or "Report"
	frappe.response["filename"] = f"{safe}.{extension}"
	frappe.response["filecontent"] = content
	frappe.response["type"] = "binary"


def clean_text(value):
	"""Text Excel can hold: control characters removed."""
	from frappe.utils.xlsxutils import ILLEGAL_CHARACTERS_RE

	return ILLEGAL_CHARACTERS_RE.sub("", value) if isinstance(value, str) else value


def csv_content(columns: list, rows: list) -> bytes:
	import csv
	import io

	from frappe.utils.csvutils import escape_formula_injection

	out = io.StringIO()
	writer = csv.writer(out)
	writer.writerow([escape_formula_injection(c.get("label")) for c in columns])
	for row in rows:
		writer.writerow(["" if v is None else escape_formula_injection(v) for v in row.get("cells") or []])
	return out.getvalue().encode("utf-8-sig")


def xlsx_content(title: str, subtitle: str | None, columns: list, rows: list) -> bytes:
	import io

	from openpyxl import Workbook
	from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
	from openpyxl.utils import get_column_letter

	from frappe.utils import getdate

	def put_text(cell, value):
		# text stays text: a value starting with "=" must not become a live formula
		cell.value = clean_text(value)
		if isinstance(cell.value, str):
			cell.data_type = "s"

	wb = Workbook()
	ws = wb.active
	ws.title = (re.sub(r"[\\/*?:\[\]]", " ", clean_text(title)) or "Report")[:31]
	ws.sheet_view.rightToLeft = bool(frappe.local.lang in ("ar", "fa", "he", "ur"))
	put_text(ws.cell(row=1, column=1), title)
	ws.cell(row=1, column=1).font = Font(bold=True, size=14)
	if subtitle:
		put_text(ws.cell(row=2, column=1), subtitle)
		ws.cell(row=2, column=1).font = Font(italic=True, color="7C8496")
	header_row = 4
	thin = Side(style="thin", color="C9CED8")
	date_format = (frappe.db.get_default("date_format") or "yyyy-mm-dd").lower()
	for i, col in enumerate(columns, start=1):
		cell = ws.cell(row=header_row, column=i)
		put_text(cell, col.get("label"))
		cell.font = Font(bold=True, color="4A5263")
		cell.fill = PatternFill("solid", fgColor="EEF1F6")
		cell.border = Border(bottom=thin)
		cell.alignment = Alignment(horizontal="right" if col.get("number") else "left", vertical="center")
		width = col.get("width") if isinstance(col.get("width"), int | float) else 120
		ws.column_dimensions[get_column_letter(i)].width = max(8, min(80, width / 7))

	for r_i, row in enumerate(rows, start=header_row + 1):
		kind = row.get("kind")
		styles = row.get("styles") or {}
		indent = row.get("indent")
		for c_i, value in enumerate(row.get("cells") or [], start=1):
			col = columns[c_i - 1] if c_i - 1 < len(columns) else {}
			cell = ws.cell(row=r_i, column=c_i)
			if col.get("number") and isinstance(value, int | float) and not isinstance(value, bool):
				cell.value = value
				fmt = col.get("num_format")
				cell.number_format = fmt if isinstance(fmt, str) and len(fmt) < 200 else "#,##0.00"
				cell.alignment = Alignment(horizontal="right")
			elif col.get("date") and value:
				try:
					cell.value = getdate(value)
					cell.number_format = date_format
				except Exception:
					put_text(cell, value)
			else:
				put_text(cell, value)
			cell_styles = styles.get(str(c_i - 1)) if isinstance(styles, dict) else None
			# only a list of style names counts: anything else sent by a request is ignored
			cell_styles = [x for x in cell_styles if isinstance(x, str)] if isinstance(cell_styles, list) else []
			bold = kind in ("bold", "group", "total") or "bold" in cell_styles
			color = "6B4FBB" if col.get("calc") else None
			fill = "F4F6FA" if kind == "group" else None
			for style in cell_styles:
				fill = FILLS.get(style, fill)
				color = FONT_COLORS.get(style, color)
			cell.font = Font(bold=bold, italic=bool(col.get("calc")), color=color)
			if fill:
				cell.fill = PatternFill("solid", fgColor=fill)
			if kind == "total":
				cell.fill = PatternFill("solid", fgColor="EAEEF6")
				cell.border = Border(top=Side(style="medium", color="4A5263"))
			if c_i == 1 and isinstance(indent, int) and indent > 0:
				cell.alignment = Alignment(indent=min(indent, 15))
	ws.freeze_panes = ws.cell(row=header_row + 1, column=2)
	if columns and rows:
		ws.auto_filter.ref = f"A{header_row}:{get_column_letter(len(columns))}{header_row + len(rows)}"
	out = io.BytesIO()
	wb.save(out)
	return out.getvalue()
