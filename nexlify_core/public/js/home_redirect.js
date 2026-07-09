(function () {
	var DESKTOP_ROUTES = ["", "workspaces", "workspaces/home", "app", "app/home", "home"];
	var redirecting = false;

	function get_target() {
		if (typeof frappe === "undefined" || !frappe.boot || !frappe.boot.nexlify_home_route) return null;
		return frappe.boot.nexlify_home_route
			.replace(/^\//, "")
			.replace(/^app\//, "")
			.replace(/^app$/, "");
	}

	function current_route_str() {
		var route = (frappe.get_route && frappe.get_route()) || [];
		return route.join("/").toLowerCase();
	}

	function is_desktop_home(route_str) {
		return DESKTOP_ROUTES.indexOf(route_str) !== -1;
	}

	function show_cover() {
		if (document.getElementById("nexlify-home-cover")) return;
		var el = document.createElement("div");
		el.id = "nexlify-home-cover";
		el.style.cssText =
			"position:fixed;inset:0;background:#fff;z-index:999999;" +
			"display:flex;align-items:center;justify-content:center;";
		document.documentElement.appendChild(el);
	}

	function hide_cover() {
		var el = document.getElementById("nexlify-home-cover");
		if (el) el.remove();
	}

	function redirect_now(target, with_cover) {
		if (redirecting) return;
		redirecting = true;
		if (with_cover) show_cover();

		// let the current page transition finish rendering first
		setTimeout(function () {
			frappe.set_route(target.split("/"));
			setTimeout(function () {
				hide_cover();
				redirecting = false;
			}, 200);
		}, 120);
	}

	function check_and_redirect(target, with_cover) {
		var route_str = current_route_str();
		if (is_desktop_home(route_str) && route_str !== target.toLowerCase()) {
			redirect_now(target, with_cover);
		}
	}

	show_cover();

	function init(target) {
		check_and_redirect(target, true);

		if (frappe.router && typeof frappe.router.on === "function") {
			frappe.router.on("change", function () {
				check_and_redirect(target, false);
			});
		}

		// extra safety net: re-check after the page finishes rendering
		$(document).on("page-change", function () {
			check_and_redirect(target, false);
		});
	}

	function wait_and_init() {
		if (typeof frappe === "undefined" || !frappe.boot || typeof frappe.set_route !== "function") {
			setTimeout(wait_and_init, 50);
			return;
		}
		var target = get_target();
		if (!target) {
			hide_cover();
			return;
		}
		init(target);
	}

	wait_and_init();
})();
