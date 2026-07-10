(function () {
    let nx_poll = null;
    let nx_current_dashboard = null;
    let nx_field_wrappers = [];

    const NX_MAX_POLL_ATTEMPTS = 40; // 40 * 150ms = 6s safety cutoff

    $(document).on('page-change', () => {
        if (frappe.get_route()[0] !== 'dashboard-view') return;
        clearInterval(nx_poll);
        let attempts = 0;
        nx_poll = setInterval(() => {
            attempts++;
            if (frappe.dashboard && frappe.dashboard.page && frappe.dashboard.dashboard_name) {
                clearInterval(nx_poll);
                nx_render_filter_bar();
            } else if (attempts >= NX_MAX_POLL_ATTEMPTS) {
                clearInterval(nx_poll);
                console.warn('nexlify_dashboard_filter: gave up waiting for frappe.dashboard');
            }
        }, 150);
    });

    async function nx_render_filter_bar() {
        const dashboard_name = frappe.dashboard.dashboard_name;
        if (nx_current_dashboard === dashboard_name) return;
        nx_current_dashboard = dashboard_name;

        nx_field_wrappers.forEach(w => w.remove());
        nx_field_wrappers = [];

        const [config, saved] = await Promise.all([
            frappe.xcall('nexlify_core.dashboard_filter_api.get_dash_filter_config'),
            frappe.xcall('nexlify_core.dashboard_filter_api.get_dash_filters'),
        ]);

        window.nexlify_dash_filters = window.nexlify_dash_filters || {};
        Object.assign(window.nexlify_dash_filters, saved);

        const relevant = config.filter(f => !f.dashboard || f.dashboard === dashboard_name);
        const target_parent = frappe.dashboard.page.filters;

        relevant.forEach(f => {
            const field = frappe.dashboard.page.add_field({
                fieldname: f.filter_key,
                fieldtype: f.field_type,
                options: f.field_type === 'Link' ? f.link_doctype : f.select_options,
                label: f.label,
                default: saved[f.filter_key] || '',
                change() {
                    const val = field.get_value();
                    window.nexlify_dash_filters[f.filter_key] = val || '';
                    frappe.xcall('nexlify_core.dashboard_filter_api.set_dash_filter', { key: f.filter_key, value: val });
                    nx_refresh_widgets();
                }
            }, target_parent);
            nx_field_wrappers.push($(field.wrapper));
            if (saved[f.filter_key]) field.set_value(saved[f.filter_key]);
        });

        target_parent.show();
    }

    function nx_refresh_widgets() {
        frappe.dashboard.chart_group && frappe.dashboard.chart_group.widgets_list.forEach(c => { delete c.filters; delete c.filter_group; delete c.chart_settings; c.refresh(); });
        frappe.dashboard.number_card_group && frappe.dashboard.number_card_group.widgets_list.forEach(c => c.render_card());
    }
})();
