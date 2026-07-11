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

    async function nx_apply_filter_value(filter_key, raw_value) {
        // Keep the raw single value (used by Report/Custom charts, which only
        // ever accept one value), and separately compute the expanded list
        // (self + descendants, or everything when empty) for tree filters
        // used by regular Count/Sum/Group By charts.
        window.nexlify_dash_filters[filter_key] = raw_value || '';
        const expanded = await frappe.xcall('nexlify_core.dashboard_filter_api.get_expanded_filter_values', {
            filter_key: filter_key,
            value: raw_value || '',
        });
        window.nexlify_dash_filters[filter_key + '__expanded'] = expanded;
    }

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

        const relevant = config.filter(f => !f.dashboard || f.dashboard === dashboard_name);
        const target_parent = frappe.dashboard.page.filters;

        // Pre-expand every relevant filter's saved (or empty) value before any
        // chart renders, so tree filters always start as a proper array.
        await Promise.all(relevant.map(f => nx_apply_filter_value(f.filter_key, saved[f.filter_key] || '')));

        relevant.forEach(f => {
            const field = frappe.dashboard.page.add_field({
                fieldname: f.filter_key,
                fieldtype: f.field_type,
                options: f.field_type === 'Link' ? f.link_doctype : f.select_options,
                label: f.label,
                default: saved[f.filter_key] || '',
                change() {
                    const val = field.get_value();
                    frappe.xcall('nexlify_core.dashboard_filter_api.set_dash_filter', { key: f.filter_key, value: val });
                    nx_apply_filter_value(f.filter_key, val).then(nx_refresh_widgets);
                }
            }, target_parent);
            nx_field_wrappers.push($(field.wrapper));
            if (saved[f.filter_key]) field.set_value(saved[f.filter_key]);

            // page.add_field toolbar fields don't get the usual Link clear
            // (x) button, so add an explicit small clear button inside the
            // input itself, positioned absolutely over its right edge.
            const $input_wrapper = $(field.wrapper).find('.control-input, .awesomplete').first();
            if ($input_wrapper.length) {
                $input_wrapper.css('position', 'relative');
                const clear_btn = $(`<span class="nx-clear-filter" title="Clear" style="position:absolute; right:6px; top:50%; transform:translateY(-50%); cursor:pointer; color: var(--text-muted); font-size:14px; line-height:1; z-index:5;">&times;</span>`);
                clear_btn.on('click', (e) => {
                    e.stopPropagation();
                    field.set_value('');
                });
                $input_wrapper.append(clear_btn);
                nx_field_wrappers.push(clear_btn);
            }
        });

        target_parent.show();

        // Hide the manual filter icon on any chart we manage, even before
        // the user changes anything, so a stale saved filter never has a
        // chance to override our injected one.
        if (frappe.dashboard.chart_group) {
            frappe.dashboard.chart_group.widgets_list.forEach(c => {
                setTimeout(() => nx_hide_manual_filter_button(c), 300);
            });
        }
    }

    function nx_is_managed_report_or_custom(c) {
        if (!c.chart_doc) return false;
        if (c.chart_doc.chart_type !== 'Report' && c.chart_doc.chart_type !== 'Custom') return false;
        const df = c.chart_doc.dynamic_filters_json || '';
        return df.includes('nexlify_dash_filters');
    }

    function nx_hide_manual_filter_button(c) {
        // Report/Custom charts save their filter dialog values into a
        // per-user Dashboard Settings record, which then permanently
        // overrides our injected filter on every future refresh. Hiding
        // the manual filter icon on charts we manage prevents that.
        if (nx_is_managed_report_or_custom(c) && c.filter_button) {
            c.filter_button.hide();
        }
    }

    function nx_refresh_widgets() {
        if (frappe.dashboard.chart_group) {
            frappe.dashboard.chart_group.widgets_list.forEach(c => {
                delete c.filters;
                delete c.filter_group;
                delete c.chart_settings;
                c.refresh();
                setTimeout(() => nx_hide_manual_filter_button(c), 300);
            });
        }
        frappe.dashboard.number_card_group && frappe.dashboard.number_card_group.widgets_list.forEach(c => c.render_card());
    }
})();
