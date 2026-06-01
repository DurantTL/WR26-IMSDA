/**
 * Camp Meeting 2026 - Availability Widget
 * Version 3.0 - Enhanced Error Handling
 * 
 * Features:
 * - Auto-refresh at configurable interval
 * - Smooth transitions
 * - Form field integration (disables sold-out options)
 * - Waitlist prompt for sold-out items
 * - ROBUST ERROR HANDLING - will never break form submission
 * 
 * Changes in v3.0:
 * - All functions wrapped in try/catch
 * - Graceful degradation if API fails
 * - Form remains fully functional even if availability check fails
 * - Better null/undefined checks
 * - Console warnings instead of breaking errors
 * - Proper value mapping for Fluent Forms payment fields
 */

(function($) {
    'use strict';
    
    // Exit gracefully if jQuery not available
    if (typeof $ === 'undefined') {
        console.warn('[CM Availability] jQuery not loaded - availability widget disabled');
        return;
    }

    /**
     * VALUE MAPPING: Google API optionId -> Fluent Forms field value
     * Update these if your form uses different values!
     */
    var VALUE_MAP = {
        'dorm': '25',   // Dorm Room price
        'rv':   '15',   // RV/Camper price  
        'tent': '5'     // Tent price
    };
    
    /**
     * FORM FIELD NAME: The name attribute of your housing selection input
     * Check your form's HTML to confirm this matches
     */
    var HOUSING_FIELD_NAME = 'housing_selection';

    $(document).ready(function() {
        try {
            initAvailabilityWidget();
        } catch (e) {
            console.warn('[CM Availability] Failed to initialize widget:', e.message);
            // Form still works - this is just the availability display
        }
    });

    function initAvailabilityWidget() {
        var $widget = $('#cm-availability-widget');
        
        // No widget on page = silently exit (normal on non-form pages)
        if (!$widget || $widget.length === 0) {
            return;
        }

        var $grid = $widget.find('.cm-grid');
        var $loading = $widget.find('.cm-loading');
        var $timestamp = $('#cm-timestamp');
        var $lastUpdated = $widget.find('.cm-last-updated');
        
        // Safe config access with fallbacks
        var cmSettings = window.cmSettings || {};
        var refreshInterval = parseInt(cmSettings.refreshInterval) || 60000;
        var apiUrl = cmSettings.apiUrl || '';
        
        if (!apiUrl) {
            // No API URL configured - show message but don't break anything
            if ($loading && $loading.length) {
                $loading.html('<span class="cm-error">Availability display unavailable</span>');
            }
            console.warn('[CM Availability] No API URL configured');
            return;
        }

        /**
         * Fetch availability from Google Apps Script
         * Wrapped in try/catch - failures won't affect form
         */
        function loadAvailability() {
            try {
                $.ajax({
                    url: apiUrl + '?action=getAvailability',
                    method: 'GET',
                    dataType: 'json',
                    timeout: 15000,
                    success: function(data) {
                        try {
                            if (data && data.success && data.housing) {
                                updateDisplay(data.housing);
                                updateTimestamp();
                                if ($loading) $loading.hide();
                                if ($grid) $grid.fadeIn(300);
                                if ($lastUpdated) $lastUpdated.fadeIn();
                            } else {
                                showError('Invalid response from server');
                                console.warn('[CM Availability] Invalid API response:', data);
                            }
                        } catch (e) {
                            console.warn('[CM Availability] Error processing response:', e.message);
                        }
                    },
                    error: function(xhr, status, error) {
                        try {
                            if ($grid && $grid.is(':visible')) {
                                // Already showing data, just update timestamp to show stale
                                if ($timestamp) {
                                    $timestamp.html('<span style="color:#f59e0b;">Connection lost - showing cached data</span>');
                                }
                            } else {
                                showError('Unable to load availability');
                            }
                            console.warn('[CM Availability] API error:', status, error);
                        } catch (e) {
                            console.warn('[CM Availability] Error handling API failure:', e.message);
                        }
                    }
                });
            } catch (e) {
                console.warn('[CM Availability] Failed to make API request:', e.message);
            }
        }

        /**
         * Update the display with fetched data
         */
        function updateDisplay(housing) {
            if (!housing || !Array.isArray(housing)) {
                console.warn('[CM Availability] Invalid housing data');
                return;
            }

            housing.forEach(function(item) {
                try {
                    if (!item || !item.optionId) return;
                    
                    var $card = $('#card-' + item.optionId);
                    var $stat = $('#count-' + item.optionId);
                    
                    if (!$stat || $stat.length === 0) return;
                    
                    // Reset classes
                    $stat.removeClass('low sold-out');
                    if ($card) $card.removeClass('sold-out-card');
                    
                    if (item.isUnlimited) {
                        $stat.html('∞');
                        if ($card) $card.find('.cm-label').text('Unlimited');
                    } else {
                        // Animate number change
                        var currentVal = parseInt($stat.text()) || 0;
                        var newVal = parseInt(item.available) || 0;
                        
                        if (currentVal !== newVal) {
                            animateNumber($stat, currentVal, newVal);
                        }
                        
                        // Apply styling based on availability
                        if (item.available <= 0) {
                            $stat.text('SOLD OUT').addClass('sold-out');
                            if ($card) {
                                $card.addClass('sold-out-card');
                                $card.find('.cm-label').text('Join Waitlist');
                                
                                // Add waitlist button if not exists
                                if ($card.find('.cm-waitlist-btn').length === 0) {
                                    $card.append(
                                        '<button type="button" class="cm-waitlist-btn" onclick="cmShowWaitlist(\'' + item.optionId + '\')">' +
                                        '📝 Join Waitlist</button>'
                                    );
                                }
                            }
                            
                            // DISABLE THE FORM OPTION
                            markOptionSoldOut(item.optionId);
                            
                        } else if (item.available <= 5) {
                            $stat.addClass('sold-out'); // Red for very low
                            if ($card) $card.find('.cm-label').text('Only ' + item.available + ' left!');
                            // Show low stock warning on form
                            markOptionLowStock(item.optionId, item.available);
                        } else if (item.available <= 15) {
                            $stat.addClass('low'); // Yellow for low
                            if ($card) $card.find('.cm-label').text('Available - Going Fast');
                            markOptionLowStock(item.optionId, item.available);
                        } else {
                            if ($card) $card.find('.cm-label').text('Available');
                            // Ensure option is enabled (in case it was previously disabled)
                            markOptionAvailable(item.optionId);
                        }
                    }
                } catch (e) {
                    console.warn('[CM Availability] Error updating display for', item.optionId, ':', e.message);
                }
            });
        }

        /**
         * DISABLE a housing option in the form (SOLD OUT)
         */
        function markOptionSoldOut(optionId) {
            try {
                var targetValue = VALUE_MAP[optionId];
                if (!targetValue) {
                    console.warn('[CM Availability] No value mapping for:', optionId);
                    return;
                }
                
                // Find the radio button by name and value
                var $input = $('input[name="' + HOUSING_FIELD_NAME + '"][value="' + targetValue + '"]');
                
                if ($input.length) {
                    // Disable the input
                    $input.prop('disabled', true);
                    
                    // Style the container
                    var $container = $input.closest('.ff-el-form-check');
                    if ($container.length) {
                        $container.addClass('ff-disabled-option').css({
                            opacity: '0.5',
                            cursor: 'not-allowed'
                        });
                        
                        // Remove any existing badges first
                        $container.find('.cm-avail-badge').remove();
                        
                        // Add SOLD OUT badge
                        $container.find('label, .ff-el-form-check-label').first()
                            .append('<span class="cm-avail-badge" style="color:#ef4444;font-weight:bold;margin-left:8px;">SOLD OUT</span>');
                    }
                    
                    // If this option was selected, deselect it
                    if ($input.is(':checked')) {
                        $input.prop('checked', false);
                        try {
                            $input.trigger('change');
                        } catch (e) {
                            // Ignore trigger errors
                        }
                    }
                    
                    console.log('[CM Availability] Disabled sold out option:', optionId);
                }
            } catch (e) {
                console.warn('[CM Availability] Error marking option sold out:', e.message);
            }
        }

        /**
         * Show LOW STOCK warning on a housing option
         */
        function markOptionLowStock(optionId, available) {
            try {
                var targetValue = VALUE_MAP[optionId];
                if (!targetValue) return;
                
                var $input = $('input[name="' + HOUSING_FIELD_NAME + '"][value="' + targetValue + '"]');
                
                if ($input.length) {
                    var $container = $input.closest('.ff-el-form-check');
                    if ($container.length) {
                        // Remove any existing badges first
                        $container.find('.cm-avail-badge').remove();
                        
                        // Add low stock badge
                        var color = available <= 5 ? '#ef4444' : '#f59e0b';
                        $container.find('label, .ff-el-form-check-label').first()
                            .append('<span class="cm-avail-badge" style="color:' + color + ';font-size:0.85em;margin-left:8px;">(' + available + ' left)</span>');
                    }
                }
            } catch (e) {
                console.warn('[CM Availability] Error marking low stock:', e.message);
            }
        }

        /**
         * Ensure option is ENABLED (re-enable if stock returns)
         */
        function markOptionAvailable(optionId) {
            try {
                var targetValue = VALUE_MAP[optionId];
                if (!targetValue) return;
                
                var $input = $('input[name="' + HOUSING_FIELD_NAME + '"][value="' + targetValue + '"]');
                
                if ($input.length) {
                    $input.prop('disabled', false);
                    
                    var $container = $input.closest('.ff-el-form-check');
                    if ($container.length) {
                        $container.removeClass('ff-disabled-option').css({
                            opacity: '1',
                            cursor: 'pointer'
                        });
                        
                        // Remove any badges
                        $container.find('.cm-avail-badge').remove();
                    }
                }
            } catch (e) {
                console.warn('[CM Availability] Error marking option available:', e.message);
            }
        }

        /**
         * Animate number change
         */
        function animateNumber($el, from, to) {
            try {
                if (!$el || !$el.length) return;
                
                $el.prop('counter', from).animate({
                    counter: to
                }, {
                    duration: 500,
                    easing: 'swing',
                    step: function(now) {
                        $el.text(Math.ceil(now));
                    },
                    complete: function() {
                        $el.text(to);
                    }
                });
            } catch (e) {
                // Fallback - just set the number directly
                if ($el) $el.text(to);
            }
        }

        /**
         * Update timestamp display
         */
        function updateTimestamp() {
            try {
                if (!$timestamp || !$timestamp.length) return;
                var now = new Date();
                var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                $timestamp.text(timeStr);
            } catch (e) {
                // Non-critical - ignore
            }
        }

        /**
         * Show error message
         */
        function showError(message) {
            try {
                if ($loading && $loading.length) {
                    $loading.html('<span class="cm-error">⚠️ ' + message + '</span>');
                }
            } catch (e) {
                // Non-critical - ignore
            }
        }

        // Initial load - wrapped in try/catch
        try {
            loadAvailability();
        } catch (e) {
            console.warn('[CM Availability] Initial load failed:', e.message);
        }
        
        // Auto-refresh - wrapped in try/catch
        if (refreshInterval > 0) {
            setInterval(function() {
                try {
                    loadAvailability();
                } catch (e) {
                    console.warn('[CM Availability] Refresh failed:', e.message);
                }
            }, refreshInterval);
        }
        
        // Expose refresh function globally (safely)
        window.cmRefreshAvailability = function() {
            try {
                loadAvailability();
            } catch (e) {
                console.warn('[CM Availability] Manual refresh failed:', e.message);
            }
        };
    }

})(jQuery);

/**
 * Global function to show waitlist modal
 * Wrapped in try/catch to never break the page
 */
function cmShowWaitlist(optionId) {
    try {
        var optionNames = {
            'dorm': 'Dorm Room',
            'rv': 'RV/Camper Hookup',
            'tent': 'Tent Campsite'
        };
        
        var optionName = optionNames[optionId] || optionId;
        
        // Simple prompt - you could replace with a proper modal
        var email = prompt(
            optionName + ' is currently sold out.\n\n' +
            'Enter your email to join the waitlist and be notified if a spot opens up:'
        );
        
        if (email && email.indexOf('@') > 0) {
            // Send to Google Apps Script
            var cmSettings = window.cmSettings || {};
            var apiUrl = cmSettings.apiUrl || '';
            
            if (!apiUrl) {
                alert('Unable to join waitlist. Please contact us directly.');
                return;
            }
            
            jQuery.ajax({
                url: apiUrl,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                    action: 'addToWaitlist',
                    email: email,
                    housingOption: optionId,
                    name: email.split('@')[0] // Basic name from email
                }),
                timeout: 15000,
                success: function(data) {
                    try {
                        if (data && data.success) {
                            alert('✅ You\'ve been added to the waitlist!\n\nPosition: #' + data.position + '\n\nWe\'ll email you at ' + email + ' if a spot opens up.');
                        } else {
                            alert('❌ ' + (data && data.error ? data.error : 'Unable to join waitlist. Please try again.'));
                        }
                    } catch (e) {
                        alert('❌ Error processing response. Please try again.');
                    }
                },
                error: function() {
                    alert('❌ Connection error. Please try again or contact us directly.');
                }
            });
        }
    } catch (e) {
        console.warn('[CM Availability] Waitlist error:', e.message);
        alert('Unable to process request. Please contact us directly.');
    }
}

/**
 * CSS for availability badges and waitlist button
 */
(function() {
    try {
        var style = document.createElement('style');
        style.textContent = 
            '#cm-availability-widget {' +
            '    margin: 0 auto;' +
            '    text-align: center;' +
            '}' +
            '.cm-grid {' +
            '    display: flex;' +
            '    flex-direction: row;' +
            '    justify-content: center;' +
            '    flex-wrap: wrap;' +
            '    gap: 20px;' +
            '}' +
            '.cm-waitlist-btn {' +
            '    display: inline-block;' +
            '    margin-top: 12px;' +
            '    padding: 8px 16px;' +
            '    font-size: 0.85rem;' +
            '    font-weight: 600;' +
            '    color: #92400e;' +
            '    background: #fef3c7;' +
            '    border: 1px solid #fcd34d;' +
            '    border-radius: 6px;' +
            '    cursor: pointer;' +
            '    transition: all 0.2s ease;' +
            '}' +
            '.cm-waitlist-btn:hover {' +
            '    background: #fcd34d;' +
            '    color: #78350f;' +
            '}' +
            '.cm-avail-badge {' +
            '    display: inline-block;' +
            '    vertical-align: middle;' +
            '}' +
            '.ff-disabled-option {' +
            '    pointer-events: none;' +
            '}';
        document.head.appendChild(style);
    } catch (e) {
        console.warn('[CM Availability] Failed to inject styles:', e.message);
    }
})();