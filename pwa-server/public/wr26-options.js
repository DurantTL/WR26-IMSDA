/* Shared option lists + <select> helpers so the staff app, registrant portal, and
 * worker page all present the same dropdowns the Fluent Form uses. Loaded as a
 * plain global (no modules) before the page script. Values match the Fluent Form
 * exactly so data stays consistent across intake paths. */
(function (global) {
  const MEAL_OPTIONS = [
    { value: 'standard', label: 'Standard' },
    { value: 'vegetarian', label: 'Vegetarian' },
    { value: 'vegan', label: 'Vegan' },
    { value: 'gluten_free', label: 'Gluten-Free' },
    { value: 'other', label: 'Other' },
  ];
  const ATTENDEE_TYPE_OPTIONS = [
    { value: 'adult', label: 'Adult' },
    { value: 'teen', label: 'Teen' },
    { value: 'child', label: 'Child' },
  ];
  const CHILDCARE_OPTIONS = [
    { value: 'no', label: 'No' },
    { value: 'yes', label: 'Yes' },
  ];
  // 10 breakouts across 4 slots. Values match Fluent Form option values exactly.
  const SEMINAR_SLOTS = [
    { slot: 'session_1', label: 'Friday 4:00–5:00 PM', ranks: 2 },
    { slot: 'session_2', label: 'Sabbath 2:00–3:15 PM', ranks: 2 },
    { slot: 'session_3', label: 'Sabbath 4:15–5:30 PM', ranks: 2 },
    { slot: 'session_4', label: 'Sunday 8:15–9:15 AM', ranks: 1 },
  ];
  const SEMINAR_FALLBACK = {
    session_1: [
      { value: 'Color Me Golden: Embracing Life in Every Season', label: 'Session A: Color Me Golden: Embracing Life in Every Season' },
      { value: 'Refined by Fire, Revealed in Beauty', label: 'Session B: Refined by Fire, Revealed in Beauty' },
    ],
    session_2: [
      { value: 'Repainted by Grace', label: 'Session C: Repainted by Grace' },
      { value: 'Color Me Open', label: 'Session D: Color Me Open' },
      { value: 'Nourished by Color', label: 'Session E: Nourished by Color' },
      { value: 'Color Me Prayerful: Discovering the Beautiful Ways We Talk With God', label: 'Session F: Color Me Prayerful: Discovering the Beautiful Ways We Talk With God' },
    ],
    session_3: [
      { value: 'Shades of Peace', label: 'Session G: Shades of Peace' },
      { value: 'Coloring Through the Chaos: Raising Children with Grace and Truth', label: 'Session H: Coloring Through the Chaos: Raising Children with Grace and Truth' },
      { value: 'Broken Crayons Still Color', label: 'Session I: Broken Crayons Still Color' },
    ],
    session_4: [
      { value: 'Brushstrokes of Leadership', label: 'Session J: Brushstrokes of Leadership' },
    ],
  };

  // Full seminar descriptions keyed by the seminar value/title.
  // summary: the bold "brochure excerpt" portion the presenter approved.
  // full: complete description with the summary portion wrapped in <strong>.
  const SEMINAR_DESCRIPTIONS = {
    'Color Me Golden: Embracing Life in Every Season': {
      presenter: 'Panel Discussion',
      slot: 'Friday 4:00–5:00 PM',
      summary: 'Come hear real stories of faith and uncover fresh avenues for kingdom purpose while exploring practical ways to transform your life experience into a lasting legacy.',
      full: 'Every season of a woman\'s life holds unique beauty, but later chapters often bring transitions that feel like winding down. God views this stage not as a time of fading, but as a vibrant season of deep impact and fruitfulness. <strong>Come hear real stories of faith and uncover fresh avenues for kingdom purpose while exploring practical ways to transform your life experience into a lasting legacy.</strong>',
    },
    'Refined by Fire, Revealed in Beauty': {
      presenter: 'Presenter TBD',
      slot: 'Friday 4:00–5:00 PM',
      summary: 'We will learn how to walk through trials without losing our faith and how to find purpose in pain while developing a strength that comes only through surrender to God.',
      full: 'In this seminar we will learn how hard seasons shape strength, depth and resilience. <strong>We will learn how to walk through trials without losing our faith and how to find purpose in pain while developing a strength that comes only through surrender to God.</strong>',
    },
    'Repainted by Grace': {
      presenter: 'Valerie Haveman',
      slot: 'Sabbath 2:00–3:15 PM',
      summary: 'We\'ll explore what it means to accept God\'s forgiveness, stop condemning ourselves, and allow His grace to repaint our hearts with truth, freedom, and hope.',
      full: 'So many women carry the stains of past mistakes, shame, regret, or feelings of not being enough. But God does not define us by the colors of our past. In this breakout session, <strong>we\'ll explore what it means to accept God\'s forgiveness, stop condemning ourselves, and allow His grace to repaint our hearts with truth, freedom, and hope.</strong> Through Scripture and personal stories, we\'ll discover how God makes broken things beautiful and invites us to see ourselves through His eyes instead of our own.',
    },
    'Color Me Open': {
      presenter: 'Mary Kendall',
      slot: 'Sabbath 2:00–3:15 PM',
      summary: 'Mary draws from business, home, and church ministry to share what she\'s learning about what it means to truly see the people around us.',
      full: 'The door is open. Are you? And what does a root canal have to do with church hospitality? More than you\'d think. Mary and her husband built Touchstone Endodontics around one mission: "Unforgettable care, start to finish" — and the same principles that turn nervous patients into raving fans can transform how we love our neighbors, our church family, and the stranger in our pew. <strong>Mary draws from business, home, and church ministry to share what she\'s learning about what it means to truly see the people around us.</strong> She doesn\'t have it all figured out — but she\'s convinced the journey is worth taking, and she\'d love some company.',
    },
    'Nourished by Color': {
      presenter: 'Stephanie Richards',
      slot: 'Sabbath 2:00–3:15 PM',
      summary: 'Participants will learn how "eating the rainbow" — incorporating a variety of brightly colored fruits and vegetables — supports immunity, heart health, gut health, and energy.',
      full: 'This seminar explores simple, evidence-based ways to improve overall health by focusing on colorful nutrition, regular movement, and healthy sun exposure. <strong>Participants will learn how "eating the rainbow" — incorporating a variety of brightly colored fruits and vegetables — supports immunity, heart health, gut health, and energy.</strong> The session will also highlight how daily activity and safe sunshine exposure work together with nutrition to promote long-term wellness and healthy aging.',
    },
    'Color Me Prayerful: Discovering the Beautiful Ways We Talk With God': {
      presenter: 'Shannon Pigsley',
      slot: 'Sabbath 2:00–3:15 PM',
      summary: 'We will explore why prayer matters so deeply in our relationship and discover the many beautiful ways we can communicate with our Heavenly Father.',
      full: 'Prayer is powerful—an intimate, ongoing conversation with a God who listens, loves, and responds. In this session, <strong>we will explore why prayer matters so deeply in our relationship and discover the many beautiful ways we can communicate with our Heavenly Father.</strong> From kneeling in quiet surrender, to praying in community, to whispering private heart-conversations throughout the day, we\'ll reflect on how the privilege of prayer draws us closer to God\'s heart. Participants will also have the opportunity to visit interactive prayer stations, each designed to help you experience different forms of prayer in meaningful, hands-on ways. This is a space to learn, to practice, and to rediscover the joy of talking with God in every shade of life.',
    },
    'Shades of Peace': {
      presenter: 'Melissa Morris',
      slot: 'Sabbath 4:15–5:30 PM',
      summary: 'We will explore how releasing past hurts can bring healing, restore relationships, and help us experience greater emotional and spiritual freedom.',
      full: 'This is a practical and encouraging seminar on letting go of anger and resentment while discovering the peace that comes through forgiveness in God. Together, <strong>we will explore how releasing past hurts can bring healing, restore relationships, and help us experience greater emotional and spiritual freedom.</strong>',
    },
    'Coloring Through the Chaos: Raising Children with Grace and Truth': {
      presenter: 'Panel Discussion',
      slot: 'Sabbath 4:15–5:30 PM',
      summary: 'This season doesn\'t require us to control every detail but does require us to guide, love and trust God with the outcome.',
      full: 'Raising children today can feel unpredictable and overwhelming but God is still at work both in your child and in you. <strong>This season doesn\'t require us to control every detail but does require us to guide, love and trust God with the outcome.</strong>',
    },
    'Broken Crayons Still Color': {
      presenter: '',
      slot: 'Sabbath 4:15–5:30 PM',
      summary: 'This session is about awareness, growth and safety regarding domestic violence and alcohol use and empowering women to be the hands and feet of Jesus in our struggling world.',
      full: 'Domestic violence and alcohol use affect families inside and outside our church. This session is about awareness, growth and safety regarding domestic violence and alcohol use and empowering women to be the hands and feet of Jesus in our struggling world. Matthew 22: 37–39',
    },
    'Brushstrokes of Leadership': {
      presenter: 'Ami Cook',
      slot: 'Sunday 8:15–9:15 AM',
      summary: 'Discover how small acts of faith, kindness, and leadership become beautiful brushstrokes in God\'s masterpiece.',
      full: 'God uses ordinary women to create extraordinary ministry. In this practical and encouraging workshop, <strong>discover how small acts of faith, kindness, and leadership become beautiful brushstrokes in God\'s masterpiece.</strong> Learn creative ways to build women\'s ministry in your local church, encourage connection, and lead with both grace and purpose.',
    },
  };

  // Live seminar options grouped by slot, loaded from the server when available.
  let seminarBySlot = null;

  function escapeAttr(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Render a <select> for the given attribute string (e.g. 'data-a="meal_preference"').
  // Preserves an unknown/legacy current value by appending it as a selected option,
  // so editing never silently drops data the dropdown doesn't list.
  function selectHtml(attrString, currentValue, options, placeholder) {
    const current = String(currentValue == null ? '' : currentValue);
    const known = options.some((o) => String(o.value) === current);
    const parts = [`<select ${attrString}>`];
    parts.push(`<option value=""${current === '' ? ' selected' : ''}>${escapeAttr(placeholder || '- Select -')}</option>`);
    options.forEach((o) => {
      parts.push(`<option value="${escapeAttr(o.value)}"${String(o.value) === current ? ' selected' : ''}>${escapeAttr(o.label)}</option>`);
    });
    if (current && !known) parts.push(`<option value="${escapeAttr(current)}" selected>${escapeAttr(current)}</option>`);
    parts.push('</select>');
    return parts.join('');
  }

  function seminarOptions(slot) {
    if (seminarBySlot && seminarBySlot[slot] && seminarBySlot[slot].length) return seminarBySlot[slot];
    return SEMINAR_FALLBACK[slot] || [];
  }

  // Fetch live seminars and group them by slot. Accepts the {seminars:[{slot,title}]}
  // shape returned by both /api/seminars and /api/seminars/public. Safe to call
  // without auth where a public endpoint is provided; falls back silently.
  async function loadSeminars(url) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return false;
      const payload = await response.json();
      const list = Array.isArray(payload.seminars) ? payload.seminars : [];
      if (!list.length) return false;
      const grouped = {};
      list.forEach((s) => {
        if (s.active === false) return;
        const slot = String(s.slot || '');
        const title = String(s.title || s.seminarTitle || '').trim();
        if (!slot || !title) return;
        (grouped[slot] = grouped[slot] || []).push({ value: title, label: title });
      });
      if (Object.keys(grouped).length) { seminarBySlot = grouped; return true; }
      return false;
    } catch (_error) {
      return false;
    }
  }

  global.WR26_OPTIONS = {
    MEAL_OPTIONS,
    ATTENDEE_TYPE_OPTIONS,
    CHILDCARE_OPTIONS,
    SEMINAR_SLOTS,
    SEMINAR_DESCRIPTIONS,
    selectHtml,
    seminarOptions,
    loadSeminars,
  };
})(window);
