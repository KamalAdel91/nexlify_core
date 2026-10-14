// Home Page Rule: keep users whose rule has Allow Desktop Access off away from
// the desk root while they move around inside the desk.
//
// Login and full page loads are handled on the server (utils/home.py): the
// login response already lands on the rule's route, and /desk is redirected
// before the desk loads. What never reaches the server is a move inside the
// desk, such as clicking the logo or Home. For those we ask Frappe's own router
// whether it is at the desk root, rather than keeping a list of routes that
// changes between Frappe versions.
(function () {
	const boot = (window.frappe && frappe.boot) || {};
	const target = boot.nexlify_home_route;
	if (!target || boot.nexlify_allow_desktop_access || !frappe.router) return;

	function at_desk_root() {
		return frappe.router.get_sub_path() === "";
	}

	function go_to_target() {
		if (target.indexOf("/desk/") === 0) {
			frappe.set_route(target.slice("/desk/".length));
		} else {
			// a website page or another app: needs a real navigation
			window.location.href = target;
		}
	}

	frappe.router.on("change", function () {
		if (at_desk_root()) go_to_target();
	});
})();
