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
                    Promise.all([
                        nx_apply_filter_value(f.filter_key, val),
                        // Whenever our filter changes, keep any manually
                        // saved filter dialog on this dashboard's Report/
                        // Custom charts in sync, so opening it never shows a
                        // stale value while the chart itself uses our filter.
                        frappe.xcall('nexlify_core.dashboard_filter_api.sync_manual_chart_filters', {
                            dashboard_name: dashboard_name,
                            target_fieldname: f.target_fieldname,
                            value: val,
                        }),
                    ]).then(nx_refresh_widgets);
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
    }

    function nx_reset_filter_group(c) {
        // The filter_group's dialog/fields remember whatever was last set
        // inside them, even after we delete the filter_group reference
        // itself and it gets rebuilt - because a fresh FilterGroup pulls its
        // initial values from this.filters, which we've already cleared, but
        // any already-open dialog DOM can still show stale values. Destroy
        // the dialog explicitly so the next open is built fresh.
        if (c.filter_group && c.filter_group.wrapper) {
            try {
                c.filter_group.wrapper.remove();
            } catch (e) {
                // ignore
            }
        }
    }

    function nx_refresh_widgets() {
        if (frappe.dashboard.chart_group) {
            frappe.dashboard.chart_group.widgets_list.forEach(c => {
                nx_reset_filter_group(c);
                delete c.filters;
                delete c.filter_group;
                delete c.chart_settings;
                c.refresh();
            });
        }
        frappe.dashboard.number_card_group && frappe.dashboard.number_card_group.widgets_list.forEach(c => c.render_card());
    }
})();
