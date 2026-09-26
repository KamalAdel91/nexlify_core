frappe.ui.form.on("Nexlify Core Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Preview Sound"), () => preview(frm));
	},
	notification_sound_type: (frm) => preview(frm),
	notification_volume: (frm) => preview(frm),
});

function load_engine() {
	if (window.nxRavenSounds) return Promise.resolve();
	return new Promise((resolve) => {
		const s = document.createElement("script");
		s.src = "/assets/nexlify_core/js/raven_float.js?v=" + Date.now();
		s.onload = resolve;
		s.onerror = resolve;
		document.head.appendChild(s);
	});
}

function preview(frm) {
	load_engine().then(() => {
		if (!window.nxRavenSounds) return frappe.show_alert({ message: __("Sound engine not found"), indicator: "red" });
		nxRavenSounds.play(frm.doc.notification_sound_type, frm.doc.notification_volume ?? 50, frm.doc.notification_sound);
	});
}
