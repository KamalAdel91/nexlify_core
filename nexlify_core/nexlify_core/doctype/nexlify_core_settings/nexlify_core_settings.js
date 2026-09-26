frappe.ui.form.on("Nexlify Core Settings", {
	refresh(frm) {
		frm.add_custom_button(__("Preview Sound"), () => preview(frm));
	},
	notification_sound_type: (frm) => preview(frm),
	notification_volume: (frm) => preview(frm),
});

function preview(frm) {
	if (!window.nxRavenSounds) return frappe.show_alert(__("Refresh the page first"));
	nxRavenSounds.play(frm.doc.notification_sound_type, frm.doc.notification_volume ?? 50, frm.doc.notification_sound);
}
