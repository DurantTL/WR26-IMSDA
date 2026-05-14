# Camp Meeting 2026 Registration System
## Complete Planning & Build Guide (v2)
### Iowa-Missouri Conference of Seventh-day Adventists

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Data Model (Google Sheets)](#2-data-model-google-sheets)
3. [Google Apps Script Backend](#3-google-apps-script-backend)
4. [Public Registration Form (Fluent Forms)](#4-public-registration-form)
5. [Staff Registration Form (Google Form)](#5-staff-registration-form)
6. [WordPress Integration](#6-wordpress-integration)
7. [Confirmation Emails](#7-confirmation-emails)
8. [Cafe Scanner PWA](#8-cafe-scanner-pwa)
9. [Check-In System PWA](#9-check-in-system-pwa)
10. [Admin Sidebar Utilities](#10-admin-sidebar-utilities)
11. [Build Order & Sessions](#11-build-order--sessions)

---

## 1. System Overview

### Event Details

| Item | Value |
|------|-------|
| **Event** | Camp Meeting 2026 |
| **Dates** | June 2-6, 2026 (Tuesday-Saturday) |
| **Location** | Sunnydale Academy Campus |
| **Registration Deadline** | May 25, 2026 |
| **Cancellation Deadline** | May 25, 2026 |

### Schedule

#### Nights Available
| Night | Date | Day |
|-------|------|-----|
| 1 | June 2, 2026 | Tuesday |
| 2 | June 3, 2026 | Wednesday |
| 3 | June 4, 2026 | Thursday |
| 4 | June 5, 2026 | Friday |
| 5 | June 6, 2026 | Saturday |

#### Meals Available
| Meal | Days | Count |
|------|------|-------|
| Breakfast | Wed, Thu, Fri, Sat | 4 meals |
| Lunch | Wed, Thu, Fri | 3 meals (Sat = donation only) |
| Supper | Tue, Wed, Thu, Fri, Sat | 5 meals |

### Pricing

#### Housing
| Option | Price/Night | Total Capacity | Notes |
|--------|-------------|----------------|-------|
| Dorm Room | $25 | 80 rooms | 2 twin beds, 4+ nights required |
| RV/Camper Hookup | $15 | 16 spots | Full hookup, numbered spots |
| Tent Campsite | $5 | Unlimited | Various locations on campus |

#### Meals
| Meal | Adult | Child (under 18) |
|------|-------|------------------|
| Breakfast | $7 | $6 |
| Lunch | $8 | $7 |
| Supper | $8 | $7 |

**Note:** Saturday lunch is donation only - no ticket required.

#### Key Deposit
| Item | Amount | Notes |
|------|--------|-------|
| Key Deposit | $5-10 (cash) | Refunded at checkout when both keys returned |
| Keys per Room | 2 | Numbered, tracked individually |

#### Payment Processing
- Square fee: 2.9% + $0.30
- Fee passed to customer
- Formula: `((subtotal) * (1/0.971 - 1)) + (0.30/0.971)`

### Payment Options

| Method | Deposit | Notes |
|--------|---------|-------|
| Square (full payment) | None | Immediate confirmation |
| Square (deposit only) | $65 | Balance due at check-in |
| Check by mail | $65 | Held until received |

### Registration Types

| Type | Form | Payment | Priority | Moveable | Key Tracking |
|------|------|---------|----------|----------|--------------|
| Paid Guest | Fluent Forms (website) | Yes | High | No | Yes |
| Staff/Pastor | Google Form (internal) | Free | Low | Yes (to hotel) | Yes |

### Cancellation Policy
- Before May 25: Full refund minus $10 processing fee
- After May 25 or no-show first night: Deposit forfeited, reservation cancelled

---

## 2. Data Model (Google Sheets)

### Sheet Name: `Camp Meeting 2026 Registration System`

---

### Tab 1: `Config`

Static configuration values.

| Row | A: Key | B: Value |
|-----|--------|----------|
| 1 | event_name | Camp Meeting 2026 |
| 2 | event_start | 2026-06-02 |
| 3 | event_end | 2026-06-06 |
| 4 | registration_deadline | 2026-05-25 |
| 5 | cancellation_deadline | 2026-05-25 |
| 6 | deposit_amount | 65 |
| 7 | cancellation_fee | 10 |
| 8 | dorm_min_nights | 4 |
| 9 | child_max_age | 17 |
| 10 | square_fee_percent | 0.029 |
| 11 | square_fee_fixed | 0.30 |
| 12 | adult_breakfast | 7 |
| 13 | adult_lunch | 8 |
| 14 | adult_supper | 8 |
| 15 | child_breakfast | 6 |
| 16 | child_lunch | 7 |
| 17 | child_supper | 7 |
| 18 | dorm_price | 25 |
| 19 | rv_price | 15 |
| 20 | tent_price | 5 |
| 21 | key_deposit_amount | 10 |
| 22 | keys_per_room | 2 |

---

### Tab 2: `Housing`

Housing inventory tracking.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | option_id | text | dorm / rv / tent |
| B | option_name | text | Display name |
| C | price_per_night | number | Nightly rate |
| D | total_capacity | number | Max units |
| E | available | number | **Formula:** `=D2-F2-G2` |
| F | reserved_paid | number | **Formula:** counts paid registrations |
| G | reserved_staff | number | **Formula:** counts staff registrations |
| H | waitlist_count | number | **Formula:** counts waitlist |
| I | is_unlimited | text | TRUE / FALSE |
| J | min_nights | number | Minimum nights required |
| K | description | text | Shown on form |
| L | status | text | active / disabled |

**Data Rows:**

| A | B | C | D | E | F | G | H | I | J | K | L |
|---|---|---|---|---|---|---|---|---|---|---|---|
| dorm | Dorm Room | 25 | 80 | =D2-F2-G2 | =COUNTIFS(...) | =COUNTIFS(...) | =COUNTIFS(...) | FALSE | 4 | 2 twin beds per room. Bring your own linens. | active |
| rv | RV/Camper Hookup | 15 | 16 | =D3-F3-G3 | =COUNTIFS(...) | =COUNTIFS(...) | =COUNTIFS(...) | FALSE | 1 | Full hookup site | active |
| tent | Tent Campsite | 5 | 999 | 999 | 0 | 0 | 0 | TRUE | 1 | Primitive camping | active |

---

### Tab 3: `Rooms`

**NEW** - Individual room/spot inventory for assignments.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | room_id | text | Room/spot identifier (e.g., "101", "RV-7") |
| B | housing_type | text | dorm / rv / tent |
| C | building | text | Building name/number (optional) |
| D | floor | number | Floor number (for accessibility) |
| E | capacity | number | Max occupants (default 2 for dorm) |
| F | features | text | Notes: "extra space", "near restroom", etc. |
| G | status | text | available / occupied / maintenance / reserved |
| H | assigned_to_reg_id | text | Registration ID if occupied |
| I | assigned_to_name | text | Guest name (for quick lookup) |
| J | notes | text | Admin notes |

**Sample Data:**

| A | B | C | D | E | F | G | H | I | J |
|---|---|---|---|---|---|---|---|---|---|
| 101 | dorm | Main | 1 | 2 | Ground floor | available | | | |
| 102 | dorm | Main | 1 | 2 | Ground floor | available | | | |
| 103 | dorm | Main | 1 | 4 | Extra space, corner room | available | | | |
| 201 | dorm | Main | 2 | 2 | | available | | | |
| 202 | dorm | Main | 2 | 2 | Near restroom | available | | | |
| RV-1 | rv | | | 1 | End spot, pull-through | available | | | |
| RV-2 | rv | | | 1 | | available | | | |
| ... | | | | | | | | | |

---

### Tab 4: `Registrations`

All registrations (paid + staff). **UPDATED with expanded check-in/key columns.**

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | reg_id | text | Format: CM26-0001 |
| B | created_at | datetime | Timestamp of submission |
| C | reg_type | text | paid / staff |
| D | status | text | confirmed / pending / deposit / cancelled / waitlist |
| E | primary_name | text | Primary registrant full name |
| F | email | text | Email address |
| G | phone | text | Phone number |
| H | address_street | text | Street address |
| I | address_city | text | City |
| J | address_state | text | State |
| K | address_zip | text | ZIP code |
| L | church | text | Home church name |
| M | housing_option | text | dorm / rv / tent / none |
| N | nights | text | Comma-separated: tue,wed,thu,fri,sat |
| O | num_nights | number | Count of nights |
| P | housing_subtotal | number | nights × price |
| Q | adults_count | number | Number of adults (18+) |
| R | children_count | number | Number of children |
| S | total_guests | number | adults + children |
| T | guest_details | text | JSON: [{name, age, isChild},...] |
| U | meal_selections | text | JSON: {breakfast:{adult:X,child:X},...} |
| V | dietary_needs | text | Dietary restrictions |
| W | special_needs | text | Accessibility, other notes |
| X | meal_subtotal | number | Calculated meal total |
| Y | subtotal | number | housing + meals |
| Z | processing_fee | number | Square fee (0 for staff/check) |
| AA | total_charged | number | Final amount charged |
| AB | amount_paid | number | Amount received |
| AC | balance_due | number | =AA-AB |
| AD | payment_method | text | square / check / free |
| AE | payment_status | text | paid / partial / pending |
| AF | transaction_id | text | Square transaction reference |
| AG | staff_role | text | Pastor / Office Staff / Volunteer (staff only) |
| AH | moveable | text | yes / no |
| **AI** | **room_assignment** | text | Room/spot number (pre-assigned) |
| **AJ** | **building** | text | Building name/number |
| **AK** | **key_1_number** | text | First key identifier |
| **AL** | **key_2_number** | text | Second key identifier |
| **AM** | **key_deposit_amount** | number | Amount collected (cash) |
| **AN** | **key_deposit_paid** | text | yes / no |
| **AO** | **key_1_returned** | text | yes / no |
| **AP** | **key_2_returned** | text | yes / no |
| **AQ** | **deposit_refunded** | text | yes / no / partial |
| **AR** | **deposit_refund_amount** | number | Amount refunded |
| **AS** | **checked_in** | text | yes / no |
| **AT** | **check_in_time** | datetime | When checked in |
| **AU** | **checked_in_by** | text | Volunteer name |
| **AV** | **welcome_packet_given** | text | yes / no |
| **AW** | **checked_out** | text | yes / no |
| **AX** | **check_out_time** | datetime | When checked out |
| **AY** | **checked_out_by** | text | Volunteer name |
| AZ | notes | text | Admin notes |
| BA | fluent_entry_id | number | Fluent Forms entry ID |
| BB | qr_data | text | QR code data string |

---

### Tab 5: `GuestDetails`

Individual guest information (one row per person).

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | guest_id | text | Auto: G-0001 |
| B | reg_id | text | Links to registration |
| C | guest_name | text | Full name |
| D | age | number | Age in years |
| E | is_child | text | yes / no (under 18) |
| F | is_primary | text | yes / no |
| G | class_assignment | text | For children: class name |
| H | sabbath_school | text | Age-appropriate class |
| I | children_meeting | text | Assigned meeting group |

**Note:** Class assignments can be auto-suggested based on age ranges:
- 0-3: Beginners
- 4-6: Kindergarten  
- 7-9: Primary
- 10-12: Junior
- 13-17: Earliteen/Youth

---

### Tab 6: `MealTickets`

Individual meal tracking for cafe scanner.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | ticket_id | text | Auto: MT-00001 |
| B | reg_id | text | Links to registration |
| C | guest_name | text | Person's name |
| D | meal_type | text | breakfast / lunch / supper |
| E | meal_day | text | tue / wed / thu / fri / sat |
| F | meal_date | date | Actual date |
| G | ticket_type | text | adult / child |
| H | price | number | Price paid (0 for staff) |
| I | redeemed | text | yes / no |
| J | redeemed_at | datetime | When scanned |
| K | redeemed_by | text | Volunteer name |
| L | notes | text | Special dietary note |

---

### Tab 7: `Payments`

Transaction log for all payments.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | payment_id | text | Auto: PAY-0001 |
| B | reg_id | text | Links to registration |
| C | payment_date | datetime | When payment received |
| D | amount | number | Payment amount |
| E | method | text | square / check / cash |
| F | type | text | full / deposit / balance / refund / key_deposit / key_refund |
| G | transaction_id | text | Square ID or check number |
| H | processed_by | text | Admin/volunteer name |
| I | notes | text | Additional notes |

---

### Tab 8: `Waitlist`

For sold-out housing options.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | waitlist_id | text | Auto: WL-0001 |
| B | created_at | datetime | When added |
| C | name | text | Contact name |
| D | email | text | Email |
| E | phone | text | Phone |
| F | housing_option | text | Requested option |
| G | nights_requested | text | Which nights |
| H | num_guests | number | Party size |
| I | position | number | Queue position |
| J | status | text | waiting / offered / accepted / expired / cancelled |
| K | offered_at | datetime | When spot offered |
| L | expires_at | datetime | Deadline to accept |
| M | notes | text | Admin notes |

---

### Tab 9: `ActivityLog`

Audit trail of all actions.

| Column | Field | Type | Description |
|--------|-------|------|-------------|
| A | timestamp | datetime | When action occurred |
| B | action | text | registration / payment / check_in / check_out / meal_scan / room_assign / key_issue / key_return / etc. |
| C | reg_id | text | Related registration |
| D | user | text | Who performed action |
| E | source | text | form / admin / scanner / checkin_pwa / system |
| F | details | text | Additional context |

---

### Tab 10: `Dashboard`

Summary metrics and charts.

#### Key Metrics (Formulas)

**Registration Counts:**
```
Total Registrations: =COUNTA(Registrations!A:A)-1
Paid Registrations: =COUNTIF(Registrations!C:C,"paid")
Staff Registrations: =COUNTIF(Registrations!C:C,"staff")
Confirmed: =COUNTIF(Registrations!D:D,"confirmed")
Pending: =COUNTIF(Registrations!D:D,"pending")
Cancelled: =COUNTIF(Registrations!D:D,"cancelled")
```

**Guest Counts:**
```
Total Guests: =SUM(Registrations!S:S)
Total Adults: =SUM(Registrations!Q:Q)
Total Children: =SUM(Registrations!R:R)
```

**Revenue:**
```
Total Charged: =SUMIF(Registrations!C:C,"paid",Registrations!AA:AA)
Total Received: =SUMIF(Registrations!C:C,"paid",Registrations!AB:AB)
Outstanding Balance: =SUMIF(Registrations!C:C,"paid",Registrations!AC:AC)
```

**Housing:**
```
Dorm Rooms Reserved: =COUNTIF(Registrations!M:M,"dorm")
Dorm Rooms Available: =Housing!E2
RV Spots Reserved: =COUNTIF(Registrations!M:M,"rv")
RV Spots Available: =Housing!E3
```

**Meals:**
```
Total Meal Tickets: =COUNTA(MealTickets!A:A)-1
Tickets Redeemed: =COUNTIF(MealTickets!I:I,"yes")
```

**Check-in Status:**
```
Checked In: =COUNTIF(Registrations!AS:AS,"yes")
Not Yet Arrived: =COUNTIFS(Registrations!D:D,"confirmed",Registrations!AS:AS,"<>yes")
Checked Out: =COUNTIF(Registrations!AW:AW,"yes")
```

**Key Tracking:**
```
Keys Out: =COUNTIF(Registrations!AN:AN,"yes")-COUNTIFS(Registrations!AO:AO,"yes",Registrations!AP:AP,"yes")
Deposits Collected: =SUMIF(Registrations!AN:AN,"yes",Registrations!AM:AM)
Deposits Refunded: =SUM(Registrations!AR:AR)
```

---

## 3. Google Apps Script Backend

### Project Setup

1. Create new Google Apps Script project
2. Link to the Google Sheet
3. Deploy as Web App (Execute as: Me, Access: Anyone)

### File Structure

```
Code.gs           - Main entry points (doGet, doPost)
Config.gs         - Configuration and constants
Utilities.gs      - Helper functions, logging, QR generation
Registration.gs   - Registration processing functions
Inventory.gs      - Housing/availability functions
MealTickets.gs    - Meal ticket generation and redemption
Payments.gs       - Payment recording
Operations.gs     - Waitlist, check-in/out operations
Email.gs          - Confirmation email functions
StaffRegistration.gs - Staff form handler
CheckIn.gs        - Check-in system endpoints (NEW)
Admin.gs          - Admin sidebar utilities (NEW)
```

### API Endpoints

#### GET Requests

| Action | URL Parameter | Returns |
|--------|---------------|---------|
| Get availability | `?action=getAvailability` | Housing and meal availability |
| Get registration | `?action=getRegistration&id=CM26-0001` | Single registration details |
| Get guest meals | `?action=getGuestMeals&id=CM26-0001` | Meal tickets for registration |
| Get check-in data | `?action=getCheckInData&id=CM26-0001` | Registration for check-in screen |
| Get arrivals | `?action=getArrivals&date=2026-06-02` | Expected arrivals for date |
| Get available rooms | `?action=getAvailableRooms` | Unassigned rooms list |
| Health check | `?action=ping` | `{success: true}` |

#### POST Requests

| Action | Purpose |
|--------|---------|
| `submitRegistration` | Process new registration (from Fluent Forms) |
| `submitStaffRegistration` | Process staff registration (from Google Form) |
| `addToWaitlist` | Add to housing waitlist |
| `redeemMeal` | Mark meal ticket as used (scanner) |
| `processCheckIn` | Complete check-in with keys (NEW) |
| `processCheckOut` | Complete check-out, key return (NEW) |
| `assignRoom` | Pre-assign room to registration (NEW) |
| `recordBalancePayment` | Record balance paid at check-in (NEW) |
| `updatePayment` | Record manual payment |

### Core Functions

*(Existing code.gs, Config.gs, Utilities.gs, etc. remain the same)*

### NEW: CheckIn.gs

```javascript
// ==========================================
// FILE: CheckIn.gs
// ==========================================

/**
 * Get registration data formatted for check-in screen
 */
function getCheckInData(regId) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  var headers = data[0];
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === regId) {
      var row = data[i];
      
      // Parse guest details
      var guests = [];
      try {
        guests = JSON.parse(row[19] || '[]');
      } catch(e) {
        guests = [];
      }
      
      return {
        success: true,
        registration: {
          regId: row[0],
          regType: row[2],
          status: row[3],
          name: row[4],
          email: row[5],
          phone: row[6],
          church: row[11],
          housingOption: row[12],
          nights: row[13],
          numNights: row[14],
          adultsCount: row[16],
          childrenCount: row[17],
          totalGuests: row[18],
          guests: guests,
          dietaryNeeds: row[21],
          specialNeeds: row[22],
          totalCharged: row[26],
          amountPaid: row[27],
          balanceDue: row[28],
          paymentStatus: row[30],
          roomAssignment: row[34],
          building: row[35],
          key1Number: row[36],
          key2Number: row[37],
          keyDepositAmount: row[38],
          keyDepositPaid: row[39],
          checkedIn: row[44],
          checkInTime: row[45],
          mealTicketCount: getMealTicketCount(regId)
        }
      };
    }
  }
  
  return { success: false, error: 'Registration not found' };
}

/**
 * Get count of meal tickets for a registration
 */
function getMealTicketCount(regId) {
  var ss = getSS();
  var sheet = ss.getSheetByName('MealTickets');
  var data = sheet.getDataRange().getValues();
  var count = 0;
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][1] === regId) count++;
  }
  
  return count;
}

/**
 * Get expected arrivals for a given date
 */
function getArrivals(dateStr) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  // Map date to night abbreviation
  var dateMap = {
    '2026-06-02': 'tue',
    '2026-06-03': 'wed',
    '2026-06-04': 'thu',
    '2026-06-05': 'fri',
    '2026-06-06': 'sat'
  };
  
  var targetNight = dateMap[dateStr] || 'tue';
  var arrivals = [];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[3];
    var nights = (row[13] || '').toLowerCase();
    var checkedIn = row[44];
    
    // Include if: confirmed/pending, includes this night, not yet checked in
    if ((status === 'confirmed' || status === 'pending' || status === 'deposit') &&
        nights.indexOf(targetNight) !== -1 &&
        checkedIn !== 'yes') {
      
      arrivals.push({
        regId: row[0],
        name: row[4],
        housingOption: row[12],
        roomAssignment: row[34],
        totalGuests: row[18],
        balanceDue: row[28],
        specialNeeds: row[22]
      });
    }
  }
  
  return {
    success: true,
    date: dateStr,
    arrivals: arrivals,
    count: arrivals.length
  };
}

/**
 * Process check-in for a registration
 */
function processCheckIn(data) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, error: 'System busy, please try again' };
  }
  
  try {
    var ss = getSS();
    var regSheet = ss.getSheetByName('Registrations');
    var regData = regSheet.getDataRange().getValues();
    
    for (var i = 1; i < regData.length; i++) {
      if (regData[i][0] === data.regId) {
        var row = i + 1;
        
        // Update room if provided (shouldn't change if pre-assigned)
        if (data.room) {
          regSheet.getRange(row, 35).setValue(data.room); // AI: room_assignment
        }
        if (data.building) {
          regSheet.getRange(row, 36).setValue(data.building); // AJ: building
        }
        
        // Key information
        if (data.key1) {
          regSheet.getRange(row, 37).setValue(data.key1); // AK: key_1_number
        }
        if (data.key2) {
          regSheet.getRange(row, 38).setValue(data.key2); // AL: key_2_number
        }
        
        // Key deposit
        var depositAmount = data.keyDepositAmount || 10;
        regSheet.getRange(row, 39).setValue(depositAmount); // AM: key_deposit_amount
        regSheet.getRange(row, 40).setValue('yes'); // AN: key_deposit_paid
        
        // Check-in status
        regSheet.getRange(row, 45).setValue('yes'); // AS: checked_in
        regSheet.getRange(row, 46).setValue(new Date()); // AT: check_in_time
        regSheet.getRange(row, 47).setValue(data.volunteer || 'Unknown'); // AU: checked_in_by
        regSheet.getRange(row, 48).setValue(data.welcomePacket ? 'yes' : 'no'); // AV: welcome_packet_given
        
        // Update room status in Rooms tab
        if (data.room) {
          updateRoomStatus(data.room, 'occupied', data.regId, regData[i][4]);
        }
        
        // Record key deposit as payment
        recordPayment({
          regId: data.regId,
          amount: depositAmount,
          method: 'cash',
          type: 'key_deposit',
          processedBy: data.volunteer || 'Check-in',
          notes: 'Keys: ' + (data.key1 || '') + ', ' + (data.key2 || '')
        });
        
        // Log activity
        logActivity('check_in', data.regId, 
          'Checked in. Room: ' + (data.room || 'N/A') + ', Keys: ' + (data.key1 || '') + '/' + (data.key2 || ''),
          'checkin_pwa');
        
        lock.releaseLock();
        return { 
          success: true, 
          message: 'Check-in complete',
          room: data.room,
          keys: [data.key1, data.key2]
        };
      }
    }
    
    lock.releaseLock();
    return { success: false, error: 'Registration not found' };
    
  } catch (error) {
    lock.releaseLock();
    return { success: false, error: error.toString() };
  }
}

/**
 * Process check-out for a registration
 */
function processCheckOut(data) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    return { success: false, error: 'System busy, please try again' };
  }
  
  try {
    var ss = getSS();
    var regSheet = ss.getSheetByName('Registrations');
    var regData = regSheet.getDataRange().getValues();
    
    for (var i = 1; i < regData.length; i++) {
      if (regData[i][0] === data.regId) {
        var row = i + 1;
        
        // Key returns
        if (data.key1Returned) {
          regSheet.getRange(row, 41).setValue('yes'); // AO: key_1_returned
        }
        if (data.key2Returned) {
          regSheet.getRange(row, 42).setValue('yes'); // AP: key_2_returned
        }
        
        // Deposit refund
        var refundAmount = data.refundAmount || 0;
        if (refundAmount > 0) {
          regSheet.getRange(row, 43).setValue('yes'); // AQ: deposit_refunded
          regSheet.getRange(row, 44).setValue(refundAmount); // AR: deposit_refund_amount
          
          // Record refund
          recordPayment({
            regId: data.regId,
            amount: -refundAmount,
            method: 'cash',
            type: 'key_refund',
            processedBy: data.volunteer || 'Check-out',
            notes: data.refundNotes || 'Key deposit refund'
          });
        } else if (data.key1Returned && data.key2Returned) {
          regSheet.getRange(row, 43).setValue('no'); // No refund processed yet
        } else {
          regSheet.getRange(row, 43).setValue('partial');
        }
        
        // Check-out status
        regSheet.getRange(row, 49).setValue('yes'); // AW: checked_out
        regSheet.getRange(row, 50).setValue(new Date()); // AX: check_out_time
        regSheet.getRange(row, 51).setValue(data.volunteer || 'Unknown'); // AY: checked_out_by
        
        // Update room status
        var roomAssignment = regData[i][34];
        if (roomAssignment) {
          updateRoomStatus(roomAssignment, 'available', '', '');
        }
        
        // Log activity
        var keysReturned = (data.key1Returned ? 1 : 0) + (data.key2Returned ? 1 : 0);
        logActivity('check_out', data.regId, 
          'Checked out. Keys returned: ' + keysReturned + '/2. Refund: $' + refundAmount,
          'checkin_pwa');
        
        lock.releaseLock();
        return { 
          success: true, 
          message: 'Check-out complete',
          refundAmount: refundAmount
        };
      }
    }
    
    lock.releaseLock();
    return { success: false, error: 'Registration not found' };
    
  } catch (error) {
    lock.releaseLock();
    return { success: false, error: error.toString() };
  }
}

/**
 * Update room status in Rooms tab
 */
function updateRoomStatus(roomId, status, regId, guestName) {
  var ss = getSS();
  var roomSheet = ss.getSheetByName('Rooms');
  var data = roomSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === roomId) {
      var row = i + 1;
      roomSheet.getRange(row, 7).setValue(status); // G: status
      roomSheet.getRange(row, 8).setValue(regId || ''); // H: assigned_to_reg_id
      roomSheet.getRange(row, 9).setValue(guestName || ''); // I: assigned_to_name
      return true;
    }
  }
  return false;
}

/**
 * Get list of available rooms for assignment
 */
function getAvailableRooms(housingType) {
  var ss = getSS();
  var roomSheet = ss.getSheetByName('Rooms');
  var data = roomSheet.getDataRange().getValues();
  
  var available = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var type = row[1];
    var status = row[6];
    
    if (status === 'available' && (!housingType || type === housingType)) {
      available.push({
        roomId: row[0],
        housingType: row[1],
        building: row[2],
        floor: row[3],
        capacity: row[4],
        features: row[5],
        notes: row[9]
      });
    }
  }
  
  return {
    success: true,
    rooms: available,
    count: available.length
  };
}

/**
 * Pre-assign a room to a registration
 */
function assignRoom(data) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var regData = regSheet.getDataRange().getValues();
  
  for (var i = 1; i < regData.length; i++) {
    if (regData[i][0] === data.regId) {
      var row = i + 1;
      
      // Set room assignment
      regSheet.getRange(row, 35).setValue(data.roomId); // AI: room_assignment
      regSheet.getRange(row, 36).setValue(data.building || ''); // AJ: building
      
      // Update room status to reserved
      updateRoomStatus(data.roomId, 'reserved', data.regId, regData[i][4]);
      
      logActivity('room_assign', data.regId, 
        'Room pre-assigned: ' + data.roomId,
        'admin');
      
      return { success: true, roomId: data.roomId };
    }
  }
  
  return { success: false, error: 'Registration not found' };
}

/**
 * Record balance payment at check-in
 */
function recordBalancePayment(data) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var regData = regSheet.getDataRange().getValues();
  
  for (var i = 1; i < regData.length; i++) {
    if (regData[i][0] === data.regId) {
      var row = i + 1;
      
      var currentPaid = regData[i][27] || 0;
      var newPaid = currentPaid + parseFloat(data.amount);
      var totalCharged = regData[i][26];
      
      regSheet.getRange(row, 28).setValue(newPaid); // AB: amount_paid
      
      // Update payment status
      if (newPaid >= totalCharged) {
        regSheet.getRange(row, 31).setValue('paid'); // AE: payment_status
      } else {
        regSheet.getRange(row, 31).setValue('partial');
      }
      
      // Record in Payments tab
      recordPayment({
        regId: data.regId,
        amount: data.amount,
        method: data.method || 'cash',
        type: 'balance',
        processedBy: data.volunteer || 'Check-in',
        notes: 'Balance payment at check-in'
      });
      
      return { 
        success: true, 
        newBalance: totalCharged - newPaid,
        paymentStatus: newPaid >= totalCharged ? 'paid' : 'partial'
      };
    }
  }
  
  return { success: false, error: 'Registration not found' };
}

/**
 * Search registrations by name (for check-in lookup)
 */
function searchRegistrations(query) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  var results = [];
  var queryLower = query.toLowerCase();
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var name = (row[4] || '').toLowerCase();
    var regId = (row[0] || '').toLowerCase();
    var status = row[3];
    
    // Skip cancelled
    if (status === 'cancelled') continue;
    
    if (name.indexOf(queryLower) !== -1 || regId.indexOf(queryLower) !== -1) {
      results.push({
        regId: row[0],
        name: row[4],
        housingOption: row[12],
        roomAssignment: row[34],
        totalGuests: row[18],
        balanceDue: row[28],
        checkedIn: row[44],
        checkedOut: row[49]
      });
    }
  }
  
  return {
    success: true,
    results: results,
    count: results.length
  };
}

/**
 * Get check-in statistics for dashboard
 */
function getCheckInStats() {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  var stats = {
    totalRegistrations: 0,
    checkedIn: 0,
    notArrived: 0,
    checkedOut: 0,
    keysOut: 0,
    depositsHeld: 0,
    balancesDue: 0
  };
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[3];
    
    if (status === 'cancelled') continue;
    
    stats.totalRegistrations++;
    
    if (row[44] === 'yes') { // checked_in
      stats.checkedIn++;
      
      if (row[49] !== 'yes') { // not checked_out
        // Count keys still out
        var key1Out = row[39] === 'yes' && row[41] !== 'yes';
        var key2Out = row[39] === 'yes' && row[42] !== 'yes';
        stats.keysOut += (key1Out ? 1 : 0) + (key2Out ? 1 : 0);
        
        // Deposits held
        if (row[39] === 'yes' && row[43] !== 'yes') {
          stats.depositsHeld += row[38] || 0;
        }
      }
    } else {
      stats.notArrived++;
    }
    
    if (row[49] === 'yes') {
      stats.checkedOut++;
    }
    
    stats.balancesDue += row[28] || 0;
  }
  
  return {
    success: true,
    stats: stats
  };
}
```

---

## 4. Public Registration Form (Fluent Forms)

*(Content remains the same as original document)*

### Form Structure

#### Step 1: Contact Information
- First Name, Last Name, Email, Phone
- Street Address, City, State, ZIP
- Home Church (optional)

#### Step 2: Housing Selection
- Live availability display
- Radio: Dorm / RV / Tent / No Housing
- Checkbox: Nights attending
- Validation: Dorm requires 4+ nights

#### Step 3: Guest Information
- Number of Adults (18+)
- Number of Children
- Repeater: Guest name + age for each person

#### Step 4: Meal Selection
- Breakfast tickets (adult/child quantities)
- Lunch tickets (adult/child quantities)
- Supper tickets (adult/child quantities)
- Dietary restrictions textarea

#### Step 5: Payment
- Calculated totals display
- Payment method selection
- Square payment integration
- Agreement checkbox

---

## 5. Staff Registration Form (Google Form)

*(Content remains the same as original document)*

Form for Pastor / Office Staff / Volunteer registrations. Free registration with meals included.

---

## 6. WordPress Integration

*(Content remains the same as original document)*

PHP plugin handles:
- Webhook from Fluent Forms to Google Apps Script
- Availability shortcode
- Retry logic for failed submissions

---

## 7. Confirmation Emails

*(Content remains the same as original document)*

HTML template with:
- Registration ID
- QR code for check-in and meals
- Housing and meal details
- Payment summary
- Important reminders

---

## 8. Cafe Scanner PWA

*(Content remains the same as original document)*

Progressive Web App for cafeteria meal ticket scanning:
- QR code scanning
- Manual ID lookup
- One-tap redemption
- Offline queue support

---

## 9. Check-In System PWA

### Overview

Dedicated Progressive Web App for check-in volunteers at the registration desk.

### Features

- **Search & Scan:** Find guests by name or QR code
- **Check-in Flow:** Balance payment → Key issue → Welcome packet
- **Check-out Flow:** Key return → Deposit refund
- **Real-time Stats:** Arrivals, checked-in count, keys out
- **Offline Support:** Queue actions when WiFi drops

### Check-In Workflow

```
1. Guest arrives
   ↓
2. Volunteer searches name or scans QR
   ↓
3. System shows:
   - Pre-assigned room
   - Balance due (if any)
   - Party size & special needs
   ↓
4. If balance due:
   - Guest pays via separate Square terminal
   - Volunteer marks "Balance Paid" + enters amount
   ↓
5. Key deposit:
   - Guest pays $5-10 cash
   - Volunteer marks "Deposit Collected"
   ↓
6. Key issue:
   - Volunteer hands 2 keys
   - Types key numbers from tags (e.g., "K-214", "K-215")
   ↓
7. Welcome packet:
   - Volunteer hands physical packet
   - Checks "Packet Given"
   ↓
8. Complete Check-In button
   ↓
9. "You're in Room 214. Enjoy Camp Meeting!"
```

### Check-Out Workflow

```
1. Guest arrives to check out
   ↓
2. Volunteer searches name
   ↓
3. System shows:
   - Room number
   - Keys issued (K-214, K-215)
   - Deposit amount ($10)
   ↓
4. Key return:
   - Volunteer checks off each key returned
   - ☑ Key 1 (K-214) returned
   - ☑ Key 2 (K-215) returned
   ↓
5. Deposit refund:
   - If both keys: Full refund
   - If missing key: Partial/no refund
   - Volunteer gives cash back
   - Marks "Refund Processed"
   ↓
6. Complete Check-Out button
```

### File Structure

```
/checkin-pwa/
  index.html
  styles.css
  app.js
  manifest.json
  sw.js (service worker)
  icons/
    icon-192.png
    icon-512.png
```

### UI Screens

#### Main Screen
```
┌──────────────────────────────────────────────────┐
│  🏕️ CAMP MEETING 2026 CHECK-IN                   │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 🔍 Search name or scan QR...               │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  [📷 Scan QR]    [⌨️ Type Name]    [📋 Arrivals] │
│                                                  │
│  ─────────────────────────────────────────────   │
│  📊 TODAY'S STATUS                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐         │
│  │    23    │ │    54    │ │    46    │         │
│  │ Checked  │ │ Expected │ │  Keys    │         │
│  │   In     │ │  Today   │ │   Out    │         │
│  └──────────┘ └──────────┘ └──────────┘         │
│                                                  │
│  🕐 Recent Activity:                             │
│  • Smith Family - Room 214 - Checked In 2:34pm  │
│  • Johnson, Mary - Room 118 - Checked In 2:21pm │
│  • Garcia Family - Checked Out 2:15pm           │
└──────────────────────────────────────────────────┘
```

#### Check-In Screen
```
┌──────────────────────────────────────────────────┐
│  ← Back                         CM26-0042        │
│                                                  │
│  ══════════════════════════════════════════════  │
│  SMITH FAMILY                                    │
│  John (42), Sarah (40), Emma (14), Lucas (10)    │
│  ══════════════════════════════════════════════  │
│                                                  │
│  🏠 PRE-ASSIGNED ROOM                            │
│  ┌────────────────────────────────────────────┐  │
│  │  Room: 214                                 │  │
│  │  Building: Main                            │  │
│  │  Notes: Ground floor (per request)         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  📅 Tue - Sat (5 nights) | 🍽️ 48 meal tickets    │
│  📝 Dietary: Gluten-free                         │
│                                                  │
│  ──────────────────────────────────────────────  │
│                                                  │
│  💰 BALANCE DUE: $85.00                          │
│  ┌────────────────────────────────────────────┐  │
│  │  ☐ Balance Paid (via Square terminal)      │  │
│  │  Amount: [$85.00    ]  Method: [Cash ▼]    │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  🔑 KEY DEPOSIT                                  │
│  ┌────────────────────────────────────────────┐  │
│  │  Deposit: $10.00 (cash)                    │  │
│  │  ☐ Deposit Collected                       │  │
│  │                                            │  │
│  │  Key 1: [________]                         │  │
│  │  Key 2: [________]                         │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  📦 ☐ Welcome packet given                       │
│                                                  │
│       [ ✅ COMPLETE CHECK-IN ]                   │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### Check-Out Screen
```
┌──────────────────────────────────────────────────┐
│  ← Back                         CM26-0042        │
│                                                  │
│  ══════════════════════════════════════════════  │
│  SMITH FAMILY - CHECK OUT                        │
│  Room: 214 (Main)                                │
│  ══════════════════════════════════════════════  │
│                                                  │
│  Checked In: Tuesday 3:15 PM                     │
│                                                  │
│  🔑 KEY RETURN                                   │
│  ┌────────────────────────────────────────────┐  │
│  │  Key 1 (K-214):  ☐ Returned                │  │
│  │  Key 2 (K-215):  ☐ Returned                │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  💰 DEPOSIT REFUND                               │
│  ┌────────────────────────────────────────────┐  │
│  │  Deposit Paid: $10.00                      │  │
│  │                                            │  │
│  │  ○ Full Refund ($10.00)                    │  │
│  │  ○ Partial Refund: [$_____ ]               │  │
│  │  ○ No Refund (key lost)                    │  │
│  │                                            │  │
│  │  ☐ Refund Given                            │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│       [ ✅ COMPLETE CHECK-OUT ]                  │
│                                                  │
└──────────────────────────────────────────────────┘
```

#### RV/Tent Check-In (Simplified)
```
┌──────────────────────────────────────────────────┐
│  ← Back                         CM26-0067        │
│                                                  │
│  ══════════════════════════════════════════════  │
│  WILSON FAMILY                                   │
│  ══════════════════════════════════════════════  │
│                                                  │
│  🚐 RV/CAMPER - Spot #7                          │
│                                                  │
│  📅 Tue - Sat (5 nights) | 🍽️ 24 meal tickets    │
│                                                  │
│  💰 Balance: $0.00 ✓ Paid in full                │
│                                                  │
│  📦 ☐ Welcome packet given                       │
│                                                  │
│       [ ✅ COMPLETE CHECK-IN ]                   │
│                                                  │
│  (No keys or deposit for RV/Tent)                │
└──────────────────────────────────────────────────┘
```

### Hosting

Deploy to Vercel, Netlify, or GitHub Pages (free).
Suggested URL: `checkin.imcsda.org` or similar subdomain.

---

## 10. Admin Sidebar Utilities

### Overview

Google Sheets sidebar with utility functions for administrators.

### Features

1. **Room Assignment Tool** - Pre-assign rooms before event
2. **Recalculate Totals** - Fix any calculation errors
3. **Move Registration** - Change housing type
4. **Resend Email** - Trigger confirmation email again
5. **Key Report** - View all keys out / missing
6. **Waitlist Management** - Promote waitlist to confirmed
7. **Export Reports** - Download filtered data

### File Structure

```
AdminSidebar.html  - The sidebar UI
Admin.gs           - Backend functions
```

### Admin.gs Functions

```javascript
// ==========================================
// FILE: Admin.gs
// ==========================================

/**
 * Show admin sidebar
 */
function showAdminSidebar() {
  var html = HtmlService.createHtmlOutputFromFile('AdminSidebar')
    .setTitle('Camp Meeting Admin')
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Add menu to spreadsheet
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🏕️ Camp Meeting')
    .addItem('Open Admin Panel', 'showAdminSidebar')
    .addSeparator()
    .addItem('Recalculate All Totals', 'recalculateAllTotals')
    .addItem('Generate Key Report', 'generateKeyReport')
    .addItem('Export Check-In List', 'exportCheckInList')
    .addToUi();
}

/**
 * Get unassigned dorm registrations
 */
function getUnassignedRegistrations() {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  var unassigned = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var housingOption = row[12];
    var roomAssignment = row[34];
    var status = row[3];
    
    if (housingOption === 'dorm' && 
        !roomAssignment && 
        status !== 'cancelled') {
      unassigned.push({
        regId: row[0],
        name: row[4],
        guests: row[18],
        nights: row[13],
        specialNeeds: row[22]
      });
    }
  }
  
  return unassigned;
}

/**
 * Recalculate totals for all registrations
 */
function recalculateAllTotals() {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var config = getConfig();
  var data = regSheet.getDataRange().getValues();
  
  var updated = 0;
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowNum = i + 1;
    
    // Calculate housing subtotal
    var housingOption = row[12];
    var numNights = row[14] || 0;
    var housingPrice = 0;
    
    if (housingOption === 'dorm') housingPrice = config.dorm_price;
    else if (housingOption === 'rv') housingPrice = config.rv_price;
    else if (housingOption === 'tent') housingPrice = config.tent_price;
    
    var housingSubtotal = housingPrice * numNights;
    
    // Calculate meal subtotal from selections
    var mealSelections = {};
    try {
      mealSelections = JSON.parse(row[20] || '{}');
    } catch(e) {}
    
    var mealSubtotal = 0;
    if (mealSelections.breakfast) {
      mealSubtotal += (mealSelections.breakfast.adult || 0) * config.adult_breakfast;
      mealSubtotal += (mealSelections.breakfast.child || 0) * config.child_breakfast;
    }
    if (mealSelections.lunch) {
      mealSubtotal += (mealSelections.lunch.adult || 0) * config.adult_lunch;
      mealSubtotal += (mealSelections.lunch.child || 0) * config.child_lunch;
    }
    if (mealSelections.supper) {
      mealSubtotal += (mealSelections.supper.adult || 0) * config.adult_supper;
      mealSubtotal += (mealSelections.supper.child || 0) * config.child_supper;
    }
    
    var subtotal = housingSubtotal + mealSubtotal;
    var balanceDue = (row[26] || 0) - (row[27] || 0);
    
    // Update cells
    regSheet.getRange(rowNum, 16).setValue(housingSubtotal); // P
    regSheet.getRange(rowNum, 24).setValue(mealSubtotal); // X
    regSheet.getRange(rowNum, 25).setValue(subtotal); // Y
    regSheet.getRange(rowNum, 29).setValue(balanceDue); // AC
    
    updated++;
  }
  
  SpreadsheetApp.getUi().alert('Recalculated ' + updated + ' registrations.');
  return updated;
}

/**
 * Generate key status report
 */
function generateKeyReport() {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  var keysOut = [];
  var keysReturned = [];
  var depositsPending = 0;
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    
    if (row[39] === 'yes') { // key_deposit_paid
      var key1Out = row[41] !== 'yes';
      var key2Out = row[42] !== 'yes';
      
      if (key1Out || key2Out) {
        keysOut.push({
          regId: row[0],
          name: row[4],
          room: row[34],
          key1: row[36],
          key2: row[37],
          key1Out: key1Out,
          key2Out: key2Out,
          deposit: row[38]
        });
        
        if (row[43] !== 'yes') {
          depositsPending += row[38] || 0;
        }
      }
    }
  }
  
  // Create report sheet
  var reportSheet = ss.getSheetByName('Key Report') || ss.insertSheet('Key Report');
  reportSheet.clear();
  
  reportSheet.appendRow(['KEY STATUS REPORT', '', '', '', 'Generated:', new Date()]);
  reportSheet.appendRow([]);
  reportSheet.appendRow(['Total Keys Out:', keysOut.length * 2 - keysOut.filter(k => !k.key1Out).length - keysOut.filter(k => !k.key2Out).length]);
  reportSheet.appendRow(['Deposits Pending Refund:', '$' + depositsPending]);
  reportSheet.appendRow([]);
  reportSheet.appendRow(['Reg ID', 'Name', 'Room', 'Key 1', 'Key 1 Status', 'Key 2', 'Key 2 Status', 'Deposit']);
  
  keysOut.forEach(function(k) {
    reportSheet.appendRow([
      k.regId,
      k.name,
      k.room,
      k.key1,
      k.key1Out ? 'OUT' : 'Returned',
      k.key2,
      k.key2Out ? 'OUT' : 'Returned',
      '$' + k.deposit
    ]);
  });
  
  SpreadsheetApp.getUi().alert('Key report generated. See "Key Report" tab.');
}

/**
 * Resend confirmation email
 */
function resendConfirmationEmail(regId) {
  sendConfirmationEmail(regId);
  return { success: true, message: 'Email sent for ' + regId };
}

/**
 * Move registration to different housing
 */
function changeHousingType(regId, newHousingType) {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var config = getConfig();
  var data = regSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0] === regId) {
      var row = i + 1;
      var numNights = data[i][14] || 0;
      
      // Get new price
      var newPrice = 0;
      if (newHousingType === 'dorm') newPrice = config.dorm_price;
      else if (newHousingType === 'rv') newPrice = config.rv_price;
      else if (newHousingType === 'tent') newPrice = config.tent_price;
      
      var newHousingSubtotal = newPrice * numNights;
      
      // Update housing option
      regSheet.getRange(row, 13).setValue(newHousingType); // M
      regSheet.getRange(row, 16).setValue(newHousingSubtotal); // P
      
      // Clear room assignment if changing away from dorm
      if (newHousingType !== 'dorm') {
        regSheet.getRange(row, 35).setValue(''); // AI
        regSheet.getRange(row, 36).setValue(''); // AJ
      }
      
      // Recalculate subtotal
      var mealSubtotal = data[i][23] || 0;
      var newSubtotal = newHousingSubtotal + mealSubtotal;
      regSheet.getRange(row, 25).setValue(newSubtotal); // Y
      
      logActivity('housing_change', regId, 
        'Changed from ' + data[i][12] + ' to ' + newHousingType,
        'admin');
      
      return { success: true, newHousingSubtotal: newHousingSubtotal };
    }
  }
  
  return { success: false, error: 'Registration not found' };
}

/**
 * Promote waitlist entry to confirmed
 */
function promoteFromWaitlist(waitlistId) {
  var ss = getSS();
  var waitSheet = ss.getSheetByName('Waitlist');
  var waitData = waitSheet.getDataRange().getValues();
  
  for (var i = 1; i < waitData.length; i++) {
    if (waitData[i][0] === waitlistId && waitData[i][9] === 'waiting') {
      var row = i + 1;
      
      // Mark as offered
      waitSheet.getRange(row, 10).setValue('offered'); // status
      waitSheet.getRange(row, 11).setValue(new Date()); // offered_at
      
      // Set expiration (48 hours)
      var expires = new Date();
      expires.setHours(expires.getHours() + 48);
      waitSheet.getRange(row, 12).setValue(expires); // expires_at
      
      // TODO: Send notification email to waitlist person
      
      logActivity('waitlist_offer', waitlistId, 
        'Spot offered to ' + waitData[i][2],
        'admin');
      
      return { 
        success: true, 
        name: waitData[i][2],
        email: waitData[i][3],
        expiresAt: expires
      };
    }
  }
  
  return { success: false, error: 'Waitlist entry not found' };
}

/**
 * Export check-in list as CSV
 */
function exportCheckInList() {
  var ss = getSS();
  var regSheet = ss.getSheetByName('Registrations');
  var data = regSheet.getDataRange().getValues();
  
  var exportData = [['Reg ID', 'Name', 'Housing', 'Room', 'Guests', 'Balance', 'Status', 'Checked In']];
  
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var status = row[3];
    
    if (status === 'cancelled') continue;
    
    exportData.push([
      row[0],  // reg_id
      row[4],  // name
      row[12], // housing_option
      row[34], // room_assignment
      row[18], // total_guests
      row[28], // balance_due
      row[3],  // status
      row[44]  // checked_in
    ]);
  }
  
  // Create export sheet
  var exportSheet = ss.getSheetByName('Check-In Export') || ss.insertSheet('Check-In Export');
  exportSheet.clear();
  exportSheet.getRange(1, 1, exportData.length, exportData[0].length).setValues(exportData);
  
  SpreadsheetApp.getUi().alert('Export created. See "Check-In Export" tab.\n\nTo download: File → Download → CSV');
}
```

### AdminSidebar.html

```html
<!DOCTYPE html>
<html>
<head>
  <base target="_top">
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      padding: 15px;
      font-size: 13px;
    }
    h2 {
      color: #1a365d;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 8px;
      margin-top: 0;
    }
    h3 {
      color: #4a5568;
      margin-top: 20px;
      margin-bottom: 10px;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 10px 15px;
      margin: 8px 0;
      font-size: 13px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      text-align: left;
    }
    .btn-primary {
      background: #3b82f6;
      color: white;
    }
    .btn-primary:hover {
      background: #2563eb;
    }
    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      border: 1px solid #e2e8f0;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
    }
    .btn-warning {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fcd34d;
    }
    .section {
      margin-bottom: 25px;
    }
    .input-group {
      margin: 10px 0;
    }
    .input-group label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .input-group input, .input-group select {
      width: 100%;
      padding: 8px;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      font-size: 13px;
    }
    .status {
      padding: 10px;
      border-radius: 6px;
      margin: 10px 0;
      display: none;
    }
    .status.success {
      background: #dcfce7;
      color: #166534;
      display: block;
    }
    .status.error {
      background: #fef2f2;
      color: #dc2626;
      display: block;
    }
    .loading {
      color: #64748b;
      font-style: italic;
    }
  </style>
</head>
<body>
  <h2>🏕️ Camp Meeting Admin</h2>
  
  <div id="status" class="status"></div>
  
  <div class="section">
    <h3>📊 Quick Actions</h3>
    <button class="btn btn-primary" onclick="recalculateTotals()">
      🔄 Recalculate All Totals
    </button>
    <button class="btn btn-secondary" onclick="generateKeyReport()">
      🔑 Generate Key Report
    </button>
    <button class="btn btn-secondary" onclick="exportCheckIn()">
      📋 Export Check-In List
    </button>
  </div>
  
  <div class="section">
    <h3>📧 Resend Confirmation</h3>
    <div class="input-group">
      <label>Registration ID:</label>
      <input type="text" id="resend-reg-id" placeholder="CM26-0001">
    </div>
    <button class="btn btn-secondary" onclick="resendEmail()">
      Send Confirmation Email
    </button>
  </div>
  
  <div class="section">
    <h3>🚪 Room Assignment</h3>
    <p><span id="unassigned-count">...</span> registrations need rooms</p>
    <button class="btn btn-secondary" onclick="loadUnassigned()">
      View Unassigned List
    </button>
    <div id="unassigned-list" style="margin-top:10px; max-height:200px; overflow-y:auto;"></div>
  </div>
  
  <div class="section">
    <h3>🏠 Change Housing</h3>
    <div class="input-group">
      <label>Registration ID:</label>
      <input type="text" id="change-reg-id" placeholder="CM26-0001">
    </div>
    <div class="input-group">
      <label>New Housing Type:</label>
      <select id="new-housing">
        <option value="dorm">Dorm Room</option>
        <option value="rv">RV/Camper</option>
        <option value="tent">Tent</option>
        <option value="none">No Housing</option>
      </select>
    </div>
    <button class="btn btn-warning" onclick="changeHousing()">
      ⚠️ Change Housing Type
    </button>
  </div>

  <script>
    function showStatus(message, isError) {
      var el = document.getElementById('status');
      el.textContent = message;
      el.className = 'status ' + (isError ? 'error' : 'success');
      setTimeout(function() { el.className = 'status'; }, 5000);
    }
    
    function recalculateTotals() {
      showStatus('Recalculating...', false);
      google.script.run
        .withSuccessHandler(function(count) {
          showStatus('Recalculated ' + count + ' registrations', false);
        })
        .withFailureHandler(function(err) {
          showStatus('Error: ' + err.message, true);
        })
        .recalculateAllTotals();
    }
    
    function generateKeyReport() {
      showStatus('Generating report...', false);
      google.script.run
        .withSuccessHandler(function() {
          showStatus('Key report generated! Check the "Key Report" tab.', false);
        })
        .withFailureHandler(function(err) {
          showStatus('Error: ' + err.message, true);
        })
        .generateKeyReport();
    }
    
    function exportCheckIn() {
      showStatus('Exporting...', false);
      google.script.run
        .withSuccessHandler(function() {
          showStatus('Export ready! Check "Check-In Export" tab.', false);
        })
        .withFailureHandler(function(err) {
          showStatus('Error: ' + err.message, true);
        })
        .exportCheckInList();
    }
    
    function resendEmail() {
      var regId = document.getElementById('resend-reg-id').value.trim();
      if (!regId) {
        showStatus('Enter a registration ID', true);
        return;
      }
      showStatus('Sending email...', false);
      google.script.run
        .withSuccessHandler(function(result) {
          showStatus(result.message, !result.success);
        })
        .withFailureHandler(function(err) {
          showStatus('Error: ' + err.message, true);
        })
        .resendConfirmationEmail(regId);
    }
    
    function loadUnassigned() {
      document.getElementById('unassigned-list').innerHTML = '<span class="loading">Loading...</span>';
      google.script.run
        .withSuccessHandler(function(list) {
          var html = '';
          if (list.length === 0) {
            html = '<p style="color:#16a34a;">All dorm registrations have rooms assigned! ✓</p>';
          } else {
            list.forEach(function(r) {
              html += '<div style="padding:8px; margin:4px 0; background:#f8fafc; border-radius:4px;">';
              html += '<strong>' + r.name + '</strong> (' + r.regId + ')<br>';
              html += '<small>' + r.guests + ' guests | ' + r.nights + '</small>';
              if (r.specialNeeds) html += '<br><small style="color:#f59e0b;">Note: ' + r.specialNeeds + '</small>';
              html += '</div>';
            });
          }
          document.getElementById('unassigned-list').innerHTML = html;
          document.getElementById('unassigned-count').textContent = list.length;
        })
        .withFailureHandler(function(err) {
          document.getElementById('unassigned-list').innerHTML = '<span style="color:red;">Error loading</span>';
        })
        .getUnassignedRegistrations();
    }
    
    function changeHousing() {
      var regId = document.getElementById('change-reg-id').value.trim();
      var newType = document.getElementById('new-housing').value;
      if (!regId) {
        showStatus('Enter a registration ID', true);
        return;
      }
      if (!confirm('Change housing for ' + regId + ' to ' + newType + '?\n\nThis will recalculate their total.')) {
        return;
      }
      showStatus('Updating...', false);
      google.script.run
        .withSuccessHandler(function(result) {
          if (result.success) {
            showStatus('Housing changed! New subtotal: $' + result.newHousingSubtotal, false);
          } else {
            showStatus(result.error, true);
          }
        })
        .withFailureHandler(function(err) {
          showStatus('Error: ' + err.message, true);
        })
        .changeHousingType(regId, newType);
    }
    
    // Load initial count
    loadUnassigned();
  </script>
</body>
</html>
```

---

## 11. Build Order & Sessions

### Session 1: Google Sheets Foundation
**Time estimate: 1-2 hours**

- [ ] Create new Google Sheet
- [ ] Create all tabs with headers:
  - Config, Housing, **Rooms**, Registrations, GuestDetails, MealTickets, Payments, Waitlist, ActivityLog, Dashboard
- [ ] Add Config data (including key_deposit_amount)
- [ ] Add Housing sample data
- [ ] Add Rooms sample data (80 dorm rooms, 16 RV spots)
- [ ] Set up Dashboard formulas
- [ ] Test formulas work

### Session 2: Apps Script - Core
**Time estimate: 2-3 hours**

- [ ] Create Apps Script project
- [ ] Implement doGet/doPost routing
- [ ] Implement getAvailability
- [ ] Implement processRegistration (basic)
- [ ] Deploy as web app
- [ ] Test with Postman/curl

### Session 3: Apps Script - Complete
**Time estimate: 2-3 hours**

- [ ] Implement createMealTickets
- [ ] Implement recordPayment
- [ ] Implement redeemMealTicket
- [ ] Implement waitlist functions
- [ ] Implement logging
- [ ] Test all endpoints

### Session 4: Email System
**Time estimate: 1-2 hours**

- [ ] Create EmailTemplate.html
- [ ] Implement sendConfirmationEmail
- [ ] Add QR code generation
- [ ] Test email delivery
- [ ] Create waitlist notification email
- [ ] Create reminder email template

### Session 5: WordPress Integration
**Time estimate: 2-3 hours**

- [ ] Create PHP integration file
- [ ] Add webhook handler
- [ ] Add retry logic
- [ ] Create availability shortcode
- [ ] Create availability JS/CSS
- [ ] Test end-to-end

### Session 6: Fluent Form
**Time estimate: 2-3 hours**

- [ ] Create new form structure
- [ ] Add all fields with validation
- [ ] Add conditional logic
- [ ] Add payment calculations
- [ ] Integrate availability JS
- [ ] Add waitlist popup
- [ ] Test complete flow

### Session 7: Staff Form
**Time estimate: 1 hour**

- [ ] Create Google Form
- [ ] Connect to Apps Script
- [ ] Test staff registration
- [ ] Verify confirmation email

### Session 8: Cafe Scanner PWA
**Time estimate: 2-3 hours**

- [ ] Create PWA files
- [ ] Implement QR scanning
- [ ] Implement meal redemption
- [ ] Add offline support
- [ ] Deploy to Vercel/Netlify
- [ ] Test with actual phones

### Session 9: Check-In System PWA (NEW)
**Time estimate: 3-4 hours**

- [ ] Create CheckIn.gs with all endpoints
- [ ] Create PWA files (index.html, app.js, styles.css)
- [ ] Implement search and QR scan
- [ ] Implement check-in flow (balance, keys, packet)
- [ ] Implement check-out flow (key return, refund)
- [ ] Add arrivals list view
- [ ] Add offline queue support
- [ ] Deploy to Vercel/Netlify
- [ ] Test complete flow

### Session 10: Admin Sidebar & Utilities (NEW)
**Time estimate: 1-2 hours**

- [ ] Create Admin.gs with utility functions
- [ ] Create AdminSidebar.html
- [ ] Add custom menu to spreadsheet
- [ ] Implement room assignment tool
- [ ] Implement recalculate function
- [ ] Implement key report
- [ ] Implement export functions
- [ ] Test all utilities

### Session 11: Testing & Polish
**Time estimate: 2-3 hours**

- [ ] End-to-end testing of full flow
- [ ] Test check-in/check-out scenarios
- [ ] Error handling improvements
- [ ] UI polish on all PWAs
- [ ] Documentation
- [ ] Staff training materials

---

## Summary

**Total estimated time: 19-28 hours across 11 sessions**

This system includes:
- Google Sheets (database, dashboard, reporting)
- Google Apps Script (backend logic, API)
- Fluent Forms + Square (payment processing - existing)
- Google Forms (staff registration)
- **3 PWAs:**
  - Cafe Scanner (meal redemption)
  - Check-In System (arrivals, keys, deposits)
  - *(Admin Sidebar in Sheets itself)*
- Minimal WordPress code (webhook + shortcode)

**Key Features:**
- Staff can view/edit data in familiar Google Sheets
- No complex plugin to maintain
- Real-time availability on forms
- Offline-capable meal scanning
- **Complete check-in/check-out workflow**
- **Physical key tracking with deposits**
- **Pre-assigned room management**
- QR-based check-in system
- Children's class assignments
- Comprehensive audit logging
- **Admin utilities for common tasks**

---

## Appendix: Configuration Reference

### Key Deposit

| Setting | Value |
|---------|-------|
| Default Amount | $10 (configurable) |
| Collection | Cash at check-in |
| Keys per Room | 2 |
| Refund | Full if both keys returned |

### Room Assignments

| Housing Type | Pre-assigned? | Has Keys? |
|--------------|---------------|-----------|
| Dorm | Yes | Yes (2) |
| RV | Yes (spot #) | No |
| Tent | No | No |

### Check-in Requirements

| Housing | Balance | Deposit | Keys | Welcome Packet |
|---------|---------|---------|------|----------------|
| Dorm | If due | Required | Yes | Yes |
| RV | If due | No | No | Yes |
| Tent | If due | No | No | Yes |

---

*Document updated: January 8, 2026*
*Version: 2.0*
*For: Iowa-Missouri Conference of Seventh-day Adventists*
*By: Caleb Durant with Claude AI*