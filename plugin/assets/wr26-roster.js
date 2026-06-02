/**
 * WR26 registration — custom attendee roster + seminar-card UI.
 *
 * This is the "front registration experience" layer. It renders a friendly
 * multi-attendee roster and rich seminar-selection cards on top of the Fluent
 * Form, and serializes everything into a few hidden fields that the rest of the
 * system already understands:
 *
 *   attendees_json            — the uncapped source-of-truth array of attendees
 *   attendee_count            — array length (drives the summary + GAS pricing)
 *   seminar_counts_json       — {slot:{title:firstChoiceCount}} for this party
 *   registration_roster_preview — human-readable summary for admin preview
 *
 * The WR26 plugin parser decodes attendees_json into payload.attendees; GAS then
 * writes Registrations, Attendees, and SeminarPreferences. Confirmation emails,
 * PDFs, Square pay-later links, check-in, and PWA admin all stay where they are.
 *
 * It MUST be enqueued by the plugin (it is): Fluent Forms strips <script> from
 * Custom HTML fields, so this can only run as a real asset. It self-gates on the
 * #wr26-roster mount element and is a no-op everywhere else.
 */
(function ($) {
  'use strict';

  var CFG = (typeof window !== 'undefined' && window.WR26_ROSTER) || {};

  // Built-in seminar catalog. Mirrors tools/seminars-seed.csv and the plugin's
  // wr26_seminar_catalog(). Used as a fallback so the seminar cards always render
  // even if the localized WR26_ROSTER.catalog is missing (e.g. an older plugin
  // build, or the script loaded without wp_localize_script data). Live counts are
  // still overlaid from getSeminarAvailability when the proxy is reachable.
  var DEFAULT_CATALOG = [
    { slot: 'session_1', label: 'Friday 4:00–5:00 PM', picks: 2, seminars: [
      { title: 'Color Me Golden: Embracing Life in Every Season', speaker: 'Panel Discussion' },
      { title: 'Refined by Fire, Revealed in Beauty', speaker: 'Presenter TBD' }
    ] },
    { slot: 'session_2', label: 'Sabbath 2:00–3:15 PM', picks: 2, seminars: [
      { title: 'Repainted by Grace', speaker: 'Valerie Haveman' },
      { title: 'Color Me Open', speaker: 'Mary Kendall' },
      { title: 'Nourished by Color', speaker: 'Stephanie Richards' },
      { title: 'Color Me Prayerful: Discovering the Beautiful Ways We Talk With God', speaker: 'Shannon Pigsley' }
    ] },
    { slot: 'session_3', label: 'Sabbath 4:15–5:30 PM', picks: 2, seminars: [
      { title: 'Shades of Peace', speaker: 'Melissa Morris' },
      { title: 'Coloring Through the Chaos: Raising Children with Grace and Truth', speaker: 'Panel Discussion' },
      { title: 'Broken Crayons Still Color', speaker: '' }
    ] },
    { slot: 'session_4', label: 'Sunday 8:15–9:15 AM', picks: 1, seminars: [
      { title: 'Brushstrokes of Leadership', speaker: 'Ami Cook' }
    ] }
  ];
  var CATALOG = (Array.isArray(CFG.catalog) && CFG.catalog.length) ? CFG.catalog : DEFAULT_CATALOG;

  var MEAL_OPTIONS = [
    { value: 'regular', label: 'Regular' },
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'vegan', label: 'Vegan' },
    { value: 'gluten_free', label: 'Gluten-free' }
  ];
  var TYPE_OPTIONS = [
    { value: 'adult', label: 'Adult' },
    { value: 'child', label: 'Child' }
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(t) {
    return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function newAttendee() {
    return {
      first_name: '', last_name: '', phone: '', email: '',
      attendee_type: 'adult', meal_preference: 'regular',
      dietary_needs: '', childcare_needed: 'no',
      seminar_preferences: {}
    };
  }

  function WR26Roster($mount) {
    this.$mount = $mount;
    this.$form = $mount.closest('form');
    this.attendees = [newAttendee()];
    this.availability = {}; // slot||normTitle -> {capacity, first_choice_count, ...}
    this.activateRoster();
    this.render();
    this.sync();
    this.loadAvailability();
  }

  // Signal that the JS roster is driving registration. Setting roster_active=1
  // makes Fluent Forms hide the legacy a{N}_* fields via conditional logic, which
  // also skips their (required) validation and excludes them from the submission.
  // Then cosmetically hide the leftover legacy attendee_count control, which the
  // roster owns and writes for us.
  WR26Roster.prototype.activateRoster = function () {
    this.setHidden('roster_active', '1');
    this.$form.find('[name="attendee_count"]').closest('.ff-el-group').hide();
  };

  WR26Roster.prototype.setHidden = function (name, value) {
    var $f = this.$form.find('[name="' + name + '"]');
    if ($f.length) $f.val(value).trigger('input').trigger('change');
  };

  // Serialize state into the hidden fields and notify the summary script.
  WR26Roster.prototype.sync = function () {
    var counts = {};
    this.attendees.forEach(function (a) {
      Object.keys(a.seminar_preferences || {}).forEach(function (slot) {
        var first = a.seminar_preferences[slot] && a.seminar_preferences[slot].pref_1;
        if (!first) return;
        if (!counts[slot]) counts[slot] = {};
        counts[slot][first] = (counts[slot][first] || 0) + 1;
      });
    });

    this.setHidden('attendees_json', JSON.stringify(this.attendees));
    this.setHidden('attendee_count', this.attendees.length);
    this.setHidden('seminar_counts_json', JSON.stringify(counts));
    this.setHidden('registration_roster_preview', this.buildPreview());
    $(document).trigger('wr26:roster-changed');
  };

  WR26Roster.prototype.buildPreview = function () {
    var lines = [];
    this.attendees.forEach(function (a, i) {
      var name = (a.first_name + ' ' + a.last_name).trim() || ('Attendee ' + (i + 1));
      lines.push('• ' + name + ' (' + (a.attendee_type || 'adult') + ', ' + (a.meal_preference || 'regular') + ')');
      Object.keys(a.seminar_preferences || {}).forEach(function (slot) {
        var p = a.seminar_preferences[slot] || {};
        var picks = [p.pref_1, p.pref_2].filter(Boolean).join(' / ');
        if (picks) lines.push('    ' + slot + ': ' + picks);
      });
    });
    return lines.join('\n');
  };

  WR26Roster.prototype.loadAvailability = function () {
    var self = this;
    if (!CFG.ajaxUrl) return;
    $.post(CFG.ajaxUrl, { action: 'wr26_seminar_availability', nonce: CFG.nonce })
      .done(function (res) {
        if (!res || !res.success || !Array.isArray(res.slots)) return;
        res.slots.forEach(function (slot) {
          (slot.seminars || []).forEach(function (s) {
            self.availability[slot.slot + '||' + norm(s.title)] = s;
          });
        });
        self.renderAvailability();
      });
  };

  WR26Roster.prototype.availabilityFor = function (slot, title) {
    return this.availability[slot + '||' + norm(title)] || null;
  };

  // ---- rendering ----------------------------------------------------------

  WR26Roster.prototype.render = function () {
    var self = this;
    var html = '<div class="wr26-roster">';
    this.attendees.forEach(function (a, i) {
      html += self.attendeeHtml(a, i);
    });
    html += '<div class="wr26-roster-actions">' +
      '<button type="button" class="wr26-add-attendee">+ Add another attendee</button>' +
      '</div></div>';
    this.$mount.html(html);
    this.bind();
    this.renderAvailability();
  };

  WR26Roster.prototype.attendeeHtml = function (a, i) {
    var self = this;
    var removable = this.attendees.length > 1;
    var h = '<div class="wr26-attendee" data-idx="' + i + '">';
    h += '<div class="wr26-attendee-head"><h3>Attendee ' + (i + 1) + '</h3>' +
      (removable ? '<button type="button" class="wr26-remove-attendee" aria-label="Remove attendee">Remove</button>' : '') +
      '</div>';

    h += '<div class="wr26-grid">';
    h += field('first_name', 'First name', 'text', a.first_name, true);
    h += field('last_name', 'Last name', 'text', a.last_name, true);
    h += field('phone', 'Phone', 'tel', a.phone, false);
    h += field('email', 'Email (optional)', 'email', a.email, false);
    h += select('attendee_type', 'Attendee type', TYPE_OPTIONS, a.attendee_type);
    h += select('meal_preference', 'Meal preference', MEAL_OPTIONS, a.meal_preference);
    h += select('childcare_needed', 'Childcare needed?', [
      { value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }
    ], a.childcare_needed);
    h += '</div>';
    h += '<div class="wr26-field wr26-field-wide"><label>Dietary needs / allergies</label>' +
      '<textarea data-field="dietary_needs" rows="2">' + esc(a.dietary_needs) + '</textarea></div>';

    h += '<div class="wr26-seminars"><h4>Seminar preferences</h4>';
    CATALOG.forEach(function (slot) {
      h += self.slotHtml(slot, a, i);
    });
    h += '</div>';

    h += '</div>';
    return h;

    function field(name, label, type, value, required) {
      return '<div class="wr26-field"><label>' + esc(label) + (required ? ' <span class="wr26-req">*</span>' : '') + '</label>' +
        '<input type="' + type + '" data-field="' + name + '" value="' + esc(value) + '"></div>';
    }
    function select(name, label, opts, value) {
      var o = opts.map(function (opt) {
        return '<option value="' + esc(opt.value) + '"' + (String(value) === String(opt.value) ? ' selected' : '') + '>' + esc(opt.label) + '</option>';
      }).join('');
      return '<div class="wr26-field"><label>' + esc(label) + '</label><select data-field="' + name + '">' + o + '</select></div>';
    }
  };

  WR26Roster.prototype.slotHtml = function (slot, a, i) {
    var self = this;
    var pref = (a.seminar_preferences && a.seminar_preferences[slot.slot]) || {};
    var picks = slot.picks || 1;
    var h = '<div class="wr26-slot" data-slot="' + esc(slot.slot) + '">';
    h += '<div class="wr26-slot-label">' + esc(slot.label) +
      (picks > 1 ? ' <span class="wr26-slot-hint">— choose a 1st and 2nd choice</span>' : '') + '</div>';
    h += '<div class="wr26-cards">';
    (slot.seminars || []).forEach(function (s) {
      var rank = pref.pref_1 === s.title ? 1 : (pref.pref_2 === s.title ? 2 : 0);
      h += self.cardHtml(slot, s, rank, picks);
    });
    h += '</div></div>';
    return h;
  };

  WR26Roster.prototype.cardHtml = function (slot, s, rank, picks) {
    var cls = 'wr26-card' + (rank ? ' is-rank-' + rank : '');
    var h = '<div class="' + cls + '" data-title="' + esc(s.title) + '">';
    if (rank) h += '<span class="wr26-rank-badge">' + (rank === 1 ? '1st choice' : '2nd choice') + '</span>';
    h += '<div class="wr26-card-title">' + esc(s.title) + '</div>';
    if (s.speaker) h += '<div class="wr26-card-speaker">' + esc(s.speaker) + '</div>';
    h += '<div class="wr26-card-avail" data-avail-slot="' + esc(slot.slot) + '" data-avail-title="' + esc(norm(s.title)) + '"></div>';
    h += '<div class="wr26-card-buttons">';
    h += '<button type="button" class="wr26-pick" data-rank="1">' + (rank === 1 ? '✓ 1st choice' : 'Choose as 1st') + '</button>';
    if (picks > 1) {
      h += '<button type="button" class="wr26-pick" data-rank="2">' + (rank === 2 ? '✓ 2nd choice' : 'Choose as 2nd') + '</button>';
    }
    h += '</div></div>';
    return h;
  };

  // Overlay live availability badges/progress onto already-rendered cards.
  WR26Roster.prototype.renderAvailability = function () {
    var self = this;
    this.$mount.find('.wr26-card-avail').each(function () {
      var $el = $(this);
      var info = self.availability[$el.data('avail-slot') + '||' + $el.data('avail-title')];
      if (!info) { $el.empty(); return; }
      var statusMap = {
        good_availability: { label: 'Good availability', cls: 'ok' },
        limited_availability: { label: 'Filling up', cls: 'warn' },
        full: { label: 'Full — may be reassigned', cls: 'full' }
      };
      var st = statusMap[info.status] || statusMap.good_availability;
      var interested = Number(info.first_choice_count || 0);
      var cap = Number(info.capacity || 0);
      var bar = '';
      if (cap > 0) {
        var load = Math.max(Number(info.assigned_count || 0), interested);
        var pct = Math.min(100, Math.round((load / cap) * 100));
        bar = '<div class="wr26-bar"><span style="width:' + pct + '%"></span></div>';
      }
      var meta = interested + ' interested' + (cap > 0 ? ' · cap ' + cap : '');
      $el.html('<span class="wr26-badge wr26-badge-' + st.cls + '">' + esc(st.label) + '</span>' +
        '<span class="wr26-avail-meta">' + esc(meta) + '</span>' + bar);
    });
  };

  // ---- events -------------------------------------------------------------

  WR26Roster.prototype.bind = function () {
    var self = this;
    var $m = this.$mount;

    $m.off('.wr26').on('input.wr26 change.wr26', '[data-field]', function () {
      var $el = $(this);
      var idx = $el.closest('.wr26-attendee').data('idx');
      var field = $el.data('field');
      if (self.attendees[idx]) {
        self.attendees[idx][field] = $el.val();
        self.sync();
      }
    });

    $m.on('click.wr26', '.wr26-add-attendee', function () {
      self.attendees.push(newAttendee());
      self.render();
      self.sync();
    });

    $m.on('click.wr26', '.wr26-remove-attendee', function () {
      var idx = $(this).closest('.wr26-attendee').data('idx');
      self.attendees.splice(idx, 1);
      if (!self.attendees.length) self.attendees.push(newAttendee());
      self.render();
      self.sync();
    });

    $m.on('click.wr26', '.wr26-pick', function () {
      var $btn = $(this);
      var rank = Number($btn.data('rank'));
      var $card = $btn.closest('.wr26-card');
      var $slot = $btn.closest('.wr26-slot');
      var idx = $btn.closest('.wr26-attendee').data('idx');
      var slot = $slot.data('slot');
      var title = $card.data('title');
      self.togglePick(idx, slot, title, rank);
    });
  };

  WR26Roster.prototype.togglePick = function (idx, slot, title, rank) {
    var a = this.attendees[idx];
    if (!a) return;
    if (!a.seminar_preferences[slot]) a.seminar_preferences[slot] = {};
    var pref = a.seminar_preferences[slot];
    var key = 'pref_' + rank;
    var other = 'pref_' + (rank === 1 ? 2 : 1);

    if (pref[key] === title) {
      // Clicking the active choice clears it.
      delete pref[key];
    } else {
      // A title can't be both 1st and 2nd: if it was the other rank, clear that.
      if (pref[other] === title) delete pref[other];
      pref[key] = title;
    }
    if (!pref.pref_1 && !pref.pref_2) delete a.seminar_preferences[slot];

    this.render();
    this.sync();
  };

  $(function () {
    var $mount = $('#wr26-roster');
    if (!$mount.length) return;
    new WR26Roster($mount);
  });
})(jQuery);
