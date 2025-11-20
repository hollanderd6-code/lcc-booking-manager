// ============================================
// API INTEGRATION FOR CALENDAR
// ============================================

const CalendarAPI = {
  baseURL: window.location.origin,
  
  // Get authorization header
  getAuthHeader() {
    const token = localStorage.getItem('lcc_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  },

  // Properties endpoints
  properties: {
    async getAll() {
      try {
        const response = await fetch(`${this.baseURL}/api/properties`, {
          headers: this.getAuthHeader()
        });
        if (!response.ok) throw new Error('Failed to fetch properties');
        return await response.json();
      } catch (error) {
        console.error('Error fetching properties:', error);
        return [];
      }
    },

    async create(propertyData) {
      const response = await fetch(`${this.baseURL}/api/properties`, {
        method: 'POST',
        headers: {
          ...this.getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(propertyData)
      });
      if (!response.ok) throw new Error('Failed to create property');
      return await response.json();
    },

    async update(id, propertyData) {
      const response = await fetch(`${this.baseURL}/api/properties/${id}`, {
        method: 'PUT',
        headers: {
          ...this.getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(propertyData)
      });
      if (!response.ok) throw new Error('Failed to update property');
      return await response.json();
    },

    async delete(id) {
      const response = await fetch(`${this.baseURL}/api/properties/${id}`, {
        method: 'DELETE',
        headers: this.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to delete property');
      return true;
    }
  },

  // Bookings endpoints
  bookings: {
    async getAll(filters = {}) {
      const queryParams = new URLSearchParams(filters);
      const response = await fetch(`${this.baseURL}/api/bookings?${queryParams}`, {
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to fetch bookings');
      return await response.json();
    },

    async getByDateRange(startDate, endDate) {
      return this.getAll({ startDate, endDate });
    },

    async getByProperty(propertyId) {
      return this.getAll({ propertyId });
    },

    async create(bookingData) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/bookings`, {
        method: 'POST',
        headers: {
          ...CalendarAPI.getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookingData)
      });
      if (!response.ok) throw new Error('Failed to create booking');
      return await response.json();
    },

    async update(id, bookingData) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/bookings/${id}`, {
        method: 'PUT',
        headers: {
          ...CalendarAPI.getAuthHeader(),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(bookingData)
      });
      if (!response.ok) throw new Error('Failed to update booking');
      return await response.json();
    },

    async delete(id) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/bookings/${id}`, {
        method: 'DELETE',
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to delete booking');
      return true;
    }
  },

  // iCal sync endpoints
  sync: {
    async syncAll() {
      const response = await fetch(`${CalendarAPI.baseURL}/api/sync`, {
        method: 'POST',
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to sync calendars');
      return await response.json();
    },

    async syncProperty(propertyId) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/sync/${propertyId}`, {
        method: 'POST',
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to sync property');
      return await response.json();
    }
  },

  // Statistics endpoints
  statistics: {
    async getOccupancy(year, month) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/statistics/occupancy?year=${year}&month=${month}`, {
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to fetch occupancy');
      return await response.json();
    },

    async getRevenue(year, month) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/statistics/revenue?year=${year}&month=${month}`, {
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to fetch revenue');
      return await response.json();
    },

    async getUpcomingArrivals(days = 7) {
      const response = await fetch(`${CalendarAPI.baseURL}/api/statistics/arrivals?days=${days}`, {
        headers: CalendarAPI.getAuthHeader()
      });
      if (!response.ok) throw new Error('Failed to fetch arrivals');
      return await response.json();
    }
  }
};

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CalendarAPI;
}
