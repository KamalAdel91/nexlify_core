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

	function path_route_str() {
		var path = window.location.pathname || "";
		path = path.replace(/^\/(app|desk)\/?/, "");
		path = path.replace(/\/$/, "");
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
		// Use a real browser navigation instead of the SPA router. Calling
		// frappe.set_route() can resolve its promise once the route state is
		// updated without the page component actually finishing render,
		// leaving the old page visible under the new URL. A full navigation
		// guarantees the target page actually renders.
		setTimeout(function () {
			window.location.href = "/" + (window.location.pathname.indexOf("/desk/") === 0 ? "desk" : "app") + "/" + target;
		}, 50);
	}

	function init(target, allow_desktop_access) {
		if (is_desktop_home(path_route_str()) && path_route_str() !== target.toLowerCase()) {
			redirect_now(target, true);
		} else {
			hide_cover();
		}

		if (!allow_desktop_access) {
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
