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

	// Reads the ACTUAL current path from the browser URL, not frappe's router
	// (which may not be initialized yet on a fresh page load / hard refresh)
	function path_route_str() {
		var path = window.location.pathname || "";
		path = path.replace(/^\/(app|desk)\/?/, ""); // strip /app/ or /desk/ prefix
		path = path.replace(/\/$/, ""); // strip trailing slash
		return decodeURIComponent(path).toLowerCase();
	}

	function router_route_str() {
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

		setTimeout(function () {
			frappe.set_route(target.split("/"));
			setTimeout(function () {
				hide_cover();
				redirecting = false;
			}, 200);
		}, 120);
	}

	function init(target, allow_desktop_access) {
		// initial load: check the REAL browser URL, not the (possibly uninitialized) router
		if (is_desktop_home(path_route_str()) && path_route_str() !== target.toLowerCase()) {
			redirect_now(target, true);
		} else {
			hide_cover();
		}

		if (!allow_desktop_access) {
			// subsequent in-app navigations: router is reliable here
			if (frappe.router && typeof frappe.router.on === "function") {
				frappe.router.on("change", function () {
					var route_str = router_route_str();
					if (is_desktop_home(route_str) && route_str !== target.toLowerCase()) {
						redirect_now(target, false);
					}
				});
			}
		}
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
		init(target, !!frappe.boot.nexlify_allow_desktop_access);
	}

	wait_and_init();
})();
