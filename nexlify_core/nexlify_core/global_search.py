"""Global Search that finds part of a word too (Nexlify Core Settings > Search Inside Words, off until ticked).

Frappe's search is MariaDB's full-text match, which finds whole words: 2676 finds nothing in PR-00002676-EG, where
00002676 is the word. Ticked, when Frappe's search finds fewer than asked, the documents whose text in Global Search
(__global_search.content) has what was typed anywhere come after its own results: the same DocTypes, the same
permission checks, on the first page of results."""

import frappe
from frappe.utils import cint
from frappe.utils.global_search import search as frappe_search

# shorter is too common to mean anything
MIN_LENGTH = 3


@frappe.whitelist()
def search(text: str, start: int = 0, limit: int = 20, doctype: str = ""):
	results = frappe_search(text, start, limit, doctype)
	if cint(start) or len(results) >= cint(limit) or not cint(
		frappe.db.get_single_value("Nexlify Core Settings", "search_inside_words")
	):
		return results
	words = [w.strip() for w in (text or "").split("&") if len(w.strip()) >= MIN_LENGTH]
	if not words:
		return results

	from frappe.desk.doctype.global_search_settings.global_search_settings import get_doctypes_for_global_search

	allowed = set(get_doctypes_for_global_search()) & set(frappe.get_user().get_can_read())
	if doctype:
		allowed &= {doctype}
	if not allowed:
		return results
	seen = {(r.doctype, r.name) for r in results}
	table = frappe.qb.Table("__global_search")
	for word in words:
		pattern = "%" + word.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
		rows = (
			frappe.qb.from_(table)
			.select(table.doctype, table.name, table.content)
			.where(table.doctype.isin(list(allowed)))
			.where(table.content.like(pattern))
			.limit(cint(limit) * 2)
			.run(as_dict=True)
		)
		for row in rows:
			if len(results) >= cint(limit):
				return results
			if (row.doctype, row.name) in seen:
				continue
			seen.add((row.doctype, row.name))
			found = readable(row)
			if found:
				results.append(found)
	return results


def readable(row):
	"""The row as Frappe's search gives one (its title and image), when the user may read its document."""
	try:
		meta = frappe.get_meta(row.doctype)
		doc = frappe.get_lazy_doc(row.doctype, row.name)
		if not frappe.has_permission(row.doctype, doc=doc):
			return None
		row.rank = 0
		if meta.image_field:
			row.image = doc.get(meta.image_field)
		if meta.title_field:
			row.title = doc.get(meta.title_field)
		return row
	except Exception:
		frappe.clear_messages()
		return None
