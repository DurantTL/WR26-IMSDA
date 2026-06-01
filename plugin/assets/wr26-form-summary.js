/**
 * WR26 registration — live payment summary + recalc.
 *
 * This script powers the "Your Registration Summary" box on the Fluent Forms
 * registration form. It MUST be enqueued by the WR26 plugin (it is, via
 * wr26-registration.php): Fluent Forms strips <script> tags out of Custom HTML
 * fields, so a <script> embedded in the form markup would render as visible
 * text and never run — which previously left every total stuck at $0.00.
 *
 * NOTE: These constants drive only the on-screen preview and the amount Square
 * charges at checkout. Google Apps Script independently recomputes the owed
 * amount from the Config sheet (EARLY_BIRD_PRICE / REGULAR_PRICE / *_END_DATE)
 * and the PromoCodes sheet, and is the source of truth for the recorded balance.
 * The plugin passes live values via window.WR26_FORM_PRICING (see
 * wr26_enqueue_form_summary in the plugin); the fallbacks below must match the
 * GAS Config sheet. Any drift is flagged by GAS reconciliation rather than
 * silently mischarging.
 */
(function($){
  var PRICING = (typeof window !== 'undefined' && window.WR26_FORM_PRICING) || {};
  var EARLY_PRICE = Number(PRICING.earlyPrice) || 125;
  var REGULAR_PRICE = Number(PRICING.regularPrice) || 145;
  var EARLY_END = PRICING.earlyEnd || '2026-08-14T23:59:59';
  var CARD_FEE_PERCENT = 0.029;
  var CARD_FEE_FIXED = 0.30;

  // Promo codes are NOT applied to the instant Square card charge. This form has
  // no Fluent Forms coupon component, and promo codes are defined only in the GAS
  // PromoCodes sheet (the source of truth). Discounting in this client-side script
  // would be spoofable and could mischarge. Instead, if a promo code is present we
  // steer the registrant to Pay Later (see recalc below); GAS then computes the
  // discounted balance and emails a Square payment link for the correct amount.
  // Card-with-no-promo pays the exact amount inline.

  function getForm(){ return $('.wr26-summary-box').closest('form'); }
  function money(n){ n = Number(n || 0); return '$' + n.toFixed(2); }
  function getVal(name){
    var $field = getForm().find('[name="' + name + '"]');
    if (!$field.length) return '';
    if ($field.is(':radio')) return getForm().find('[name="' + name + '"]:checked').val() || '';
    return $field.val() || '';
  }
  function setHidden(name, value){
    var $field = getForm().find('[name="' + name + '"]');
    if ($field.length) $field.val(value).trigger('input').trigger('change');
  }
  function isCard(){
    var method = String(getVal('payment_method')).toLowerCase();
    return method.indexOf('square') >= 0 || method.indexOf('card') >= 0 || method.indexOf('credit') >= 0;
  }
  function promoEntered(){ return String(getVal('promo_code')).trim().length > 0; }
  function setMethod(value){
    var $radios = getForm().find('[name="payment_method"]');
    if (!$radios.length) return;
    if ($radios.is(':radio') || $radios.is(':checkbox')) {
      $radios.prop('checked', false);
      getForm().find('[name="payment_method"][value="' + value + '"]').prop('checked', true);
    } else {
      $radios.val(value);
    }
  }
  function currentPrice(){
    var now = new Date();
    var earlyEnd = new Date(EARLY_END);
    return now <= earlyEnd ? EARLY_PRICE : REGULAR_PRICE;
  }
  function attendeeCount(){
    var count = parseInt(getVal('attendee_count'), 10);
    if (!count || count < 1) count = 1;
    if (count > 5) count = 5;
    return count;
  }
  function feeFor(amount){
    if (!amount || amount <= 0) return 0;
    var totalWithFee = (amount + CARD_FEE_FIXED) / (1 - CARD_FEE_PERCENT);
    return Math.max(0, totalWithFee - amount);
  }
  var steering = false;
  function recalc(){
    if (steering) return;
    var count = attendeeCount();
    var price = currentPrice();
    var registrationSubtotal = count * price;
    var card = isCard();
    // Guard: a promo code can't discount the instant card charge, so steer card +
    // promo registrants to Pay Later instead of overcharging them the full amount.
    var steeredToPayLater = false;
    if (card && promoEntered()) {
      steering = true;
      setMethod('offline');
      getForm().find('[name="payment_method"]').trigger('change');
      steering = false;
      card = false;
      steeredToPayLater = true;
    }
    var fee = card ? feeFor(registrationSubtotal) : 0;
    var total = registrationSubtotal + fee;

    setHidden('registration_price_each', price.toFixed(2));
    setHidden('registration_subtotal', registrationSubtotal.toFixed(2));
    setHidden('discount_amount', '0.00');
    setHidden('processing_fee', fee.toFixed(2));
    setHidden('registration_total', total.toFixed(2));
    setHidden('total_amount', total.toFixed(2));
    setHidden('custom_payment_amount', total.toFixed(2));

    $('#wr26-sum-registration').text(money(registrationSubtotal));
    $('#wr26-sum-subtotal').text(money(registrationSubtotal));
    $('#wr26-sum-fee').text(money(fee));
    $('#wr26-sum-total').text(money(total));
    $('#wr26-sum-discount-row').hide();
    $('#wr26-sum-fee-row').toggle(card);
    if (steeredToPayLater) {
      $('#wr26-pay-note').html('A promo code is entered, so your payment has been set to <b>Pay Later</b>. Promo discounts can’t be applied to the instant card checkout — you’ll receive a secure Square payment link by email for the discounted amount.');
    } else {
      $('#wr26-pay-note').text(card
        ? 'Credit/debit card is selected. The processing fee is included in the total above.'
        : 'Pay Later is selected. No card fee is added. Your confirmation email will include payment instructions plus a secure Square payment link, with any promo discount applied.'
      );
    }
  }
  $(document).on('change input', '[name="attendee_count"], [name="payment_method"], [name="promo_code"]', recalc);
  $(document).ready(function(){ setTimeout(recalc, 250); setTimeout(recalc, 900); });
})(jQuery);
