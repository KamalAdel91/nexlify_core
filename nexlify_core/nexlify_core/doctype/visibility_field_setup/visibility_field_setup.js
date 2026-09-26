frappe.ui.form.on('Visibility Field Setup', {
	refresh: function(frm) {
		if (!frm.doc.field_created && !frm.is_new()) {
			frm.add_custom_button('Apply', function() {
				let grantee = frm.doc.grant_access_to === 'User' ? frm.doc.user : frm.doc.role;
				frappe.confirm(
					`سيتم إنشاء حقل "Restrict To Owner" جديد على <b>${frm.doc.target_doctype}</b>,
					وسيكون مرئياً فقط لـ <b>${grantee}</b>. هل تريد المتابعة؟`,
					function() {
						frappe.call({
							method: 'nexlify_core.nexlify_core.doctype.visibility_field_setup.visibility_field_setup.apply_visibility_field',
							args: { name: frm.doc.name },
							freeze: true,
							freeze_message: 'Applying...',
							callback: function(r) {
								if (r.message) {
									frm.reload_doc();
									frappe.show_alert({message: 'Field created successfully', indicator: 'green'});
								}
							}
						});
					}
				);
			}).addClass('btn-primary');
		}
	}
});
