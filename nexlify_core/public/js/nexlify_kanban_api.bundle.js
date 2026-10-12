// nexlify.kanban: Kanban events for Client Scripts.
//
// A Client Script with view "List" runs when the DocType loads, Kanban included, so it can do:
//
//   nexlify.kanban.on("Opportunity", {
//       async before_move(ctx) { if (!ok) return false; },    // false cancels the drag
//       after_move(ctx) {},
//       card_menu(ctx) { return [{ label: "Do it", icon: "zap", action: () => {} }]; },
//       card_badges(ctx) { return [{ label: ctx.card.status, theme: "green", tooltip: "..." }]; },
//   });
//
// ctx: { doctype, name, names, from, to, card, page, refresh() }. Handlers from several
// scripts and apps stack: each runs, and any before_move returning false cancels.
(() => {
	frappe.provide("nexlify.kanban");

	const has_kanban = () => !!frappe.kanban_v2?.extend_settings;

	function move_ctx(doctype, move) {
		return {
			doctype,
			name: move.cardId,
			names: move.cardIds || [move.cardId],
			from: move.fromColumn,
			to: move.toColumn,
			move,
		};
	}

	function card_ctx(doctype, card, page) {
		return { doctype, card, name: card.name, page, refresh: () => page?.board?.refresh?.() };
	}

	function badge_row(badges) {
		const row = document.createElement("div");
		row.className = "flex flex-wrap items-center gap-1 mt-2";
		badges.forEach((b) => {
			if (!b || !b.label) return;
			const el = frappe.ui.badge({
				label: b.label,
				theme: b.theme || "gray",
				variant: b.variant,
				icon: b.icon,
				size: b.size || "sm",
			})[0];
			if (b.tooltip) frappe.ui.tooltip(el, { text: b.tooltip });
			row.appendChild(el);
		});
		return row;
	}

	nexlify.kanban.on = function (doctype, handlers = {}) {
		if (!has_kanban()) return;
		frappe.kanban_v2.extend_settings(doctype, (base) => {
			const callbacks = { ...(base.callbacks || {}) };
			const out = { ...base, callbacks };

			if (handlers.before_move) {
				const prev = callbacks.onBeforeCardMove;
				callbacks.onBeforeCardMove = async (move) => {
					if (prev && (await prev(move)) === false) return false;
					try {
						return (await handlers.before_move(move_ctx(doctype, move))) === false ? false : undefined;
					} catch (e) {
						console.error(e);
						return false;
					}
				};
			}

			if (handlers.after_move) {
				const prev = callbacks.onAfterCardMove;
				callbacks.onAfterCardMove = (move) => {
					prev && prev(move);
					try {
						handlers.after_move(move_ctx(doctype, move));
					} catch (e) {
						console.error(e);
					}
				};
			}

			if (handlers.card_menu) {
				const prev = base.card_context_menu;
				out.card_context_menu = (card, page) => {
					const items = (prev && prev(card, page)) || [];
					let extra = [];
					try {
						extra = handlers.card_menu(card_ctx(doctype, card, page)) || [];
					} catch (e) {
						console.error(e);
					}
					return [
						...items,
						...extra.map((i) => ({
							label: i.label,
							icon: i.icon,
							theme: i.theme,
							condition: i.condition,
							onclick: i.onclick || i.action,
						})),
					];
				};
			}

			if (handlers.card_badges) {
				const prev = base.renderCard;
				out.renderCard = (card, el, ctx, page) => {
					prev ? prev(card, el, ctx, page) : page.render_card(card, el);
					try {
						const badges = handlers.card_badges(card_ctx(doctype, card, page)) || [];
						if (badges.length) el.appendChild(badge_row(badges));
					} catch (e) {
						console.error(e);
					}
				};
			}

			return out;
		});
	};
})();
