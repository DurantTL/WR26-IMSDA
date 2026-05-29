/**
 * Payment Dashboard functions for WR26.
 * Called via doPost actions: getPaymentStats, getPaymentsByStatus, getCouponStats.
 */

function getPaymentStats() {
  var regs = getAllRegistrations({});
  var stats = {
    paid: 0,
    pendingOffline: 0,
    pendingOther: 0,
    totalRevenue: 0,
    pendingRevenue: 0,
    totalDiscounts: 0,
    registrationCount: 0,
    couponBreakdown: {}
  };

  regs.forEach(function(r) {
    if (r.status === 'cancelled') return;
    stats.registrationCount++;

    var status = String(r.paymentStatus || '');
    var charged = r.amountPaid != null ? Number(r.amountPaid) : null;
    var billed  = Number(r.finalAmount || 0);

    if (status === 'paid' || status === 'paid_onsite') {
      stats.paid++;
      stats.totalRevenue += charged != null ? charged : billed;
    } else if (
      status === 'pending_offline' ||
      status === 'pending_pay_later' ||
      status === 'pending_check'
    ) {
      stats.pendingOffline++;
      stats.pendingRevenue += billed;
    } else {
      // Any other non-paid status (pending_square, pending_other, cash pay-later,
      // partial_onsite, etc.) still carries a real outstanding balance. Count the
      // amount still owed (billed minus anything already collected) toward
      // pendingRevenue instead of reporting it as $0.
      stats.pendingOther++;
      stats.pendingRevenue += Math.max(billed - (charged != null ? charged : 0), 0);
    }

    var disc = Number(r.discountAmount || 0);
    if (disc > 0) {
      stats.totalDiscounts += disc;
      var code = String(r.couponUsed || r.promoCode || '').toUpperCase();
      if (code) {
        if (!stats.couponBreakdown[code]) {
          stats.couponBreakdown[code] = { uses: 0, totalDiscount: 0 };
        }
        stats.couponBreakdown[code].uses++;
        stats.couponBreakdown[code].totalDiscount += disc;
      }
    }
  });

  return stats;
}

function getPaymentsByStatus(statusFilter) {
  return getAllRegistrations({}).filter(function(r) {
    var s = String(r.paymentStatus || '');
    if (statusFilter === 'paid') {
      return s === 'paid' || s === 'paid_onsite';
    }
    if (statusFilter === 'pending_offline') {
      return s === 'pending_offline' || s === 'pending_pay_later' || s === 'pending_check';
    }
    return s === statusFilter;
  });
}

function getCouponStats() {
  var breakdown = {};

  getAllRegistrations({}).forEach(function(r) {
    var code = String(r.couponUsed || r.promoCode || '').toUpperCase();
    if (!code) return;
    if (!breakdown[code]) {
      breakdown[code] = { uses: 0, totalDiscount: 0, totalCharged: 0 };
    }
    breakdown[code].uses++;
    breakdown[code].totalDiscount += Number(r.discountAmount || 0);
    breakdown[code].totalCharged += r.amountPaid != null
      ? Number(r.amountPaid)
      : Number(r.finalAmount || 0);
  });

  return Object.keys(breakdown).sort().map(function(code) {
    return {
      code:          code,
      uses:          breakdown[code].uses,
      totalDiscount: breakdown[code].totalDiscount,
      totalCharged:  breakdown[code].totalCharged
    };
  });
}
