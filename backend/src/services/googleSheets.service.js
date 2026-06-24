const { google } = require('googleapis');
const { env, getGoogleSheetsKeyJson } = require('../config/env');

class GoogleSheetsService {
  constructor() {
    this.sheets = null;
    this.SPREADSHEET_ID = env.googleSheets.spreadsheetId;
    this.PARTNER_SHEET_NAME = null;
    this.initializePromise = this.initializeSheets();
  }

  async initializeSheets() {
    try {
      if (!this.SPREADSHEET_ID) {
        console.warn("[GoogleSheets] GOOGLE_SHEETS_SPREADSHEET_ID is not configured. Sheets integration disabled.");
        return;
      }

      const keyFile = env.googleSheets.keyFile;
      const keyJson = getGoogleSheetsKeyJson();

      const auth = keyJson
        ? new google.auth.GoogleAuth({ credentials: keyJson, scopes: ['https://www.googleapis.com/auth/spreadsheets'] })
        : new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });

      this.sheets = google.sheets({ version: 'v4', auth });

      const spreadsheet = await this.sheets.spreadsheets.get({ spreadsheetId: this.SPREADSHEET_ID });
      const sheetTitles = spreadsheet.data.sheets.map(s => s.properties.title);
      console.log('Available sheets:', sheetTitles);

      const matched = sheetTitles.find(t => t.toLowerCase().includes('partner'));
      this.PARTNER_SHEET_NAME = matched || sheetTitles[0];
      console.log(`Using partner sheet: "${this.PARTNER_SHEET_NAME}"`);

    } catch (error) {
      console.error('[GoogleSheets] Failed to initialize Google Sheets:', error.message);
      this.sheets = null;
    }
  }

  parseKeyJson(rawValue) {
    if (!rawValue || !rawValue.trim()) return null;
    const value = rawValue.trim();
    try {
      return JSON.parse(value);
    } catch {
      try {
        return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
      } catch {
        throw new Error('GOOGLE_SHEETS_KEY_JSON must be valid JSON or base64-encoded JSON');
      }
    }
  }

  async ensureSheetsReady() {
    if (this.initializePromise) {
      await this.initializePromise;
      this.initializePromise = null;
    }
    if (!this.sheets) throw new Error('Google Sheets client is not initialized');
    if (!this.PARTNER_SHEET_NAME) throw new Error('Partner sheet name could not be resolved');
  }

  // Safely wraps sheet name in single quotes, escaping any internal single quotes
  buildRange(sheetName, range) {
    const escaped = sheetName.replace(/'/g, "''");
    return `'${escaped}'!${range}`;
  }

  async addPartnerRequestToSheet(partnerData) {
    try {
      await this.ensureSheetsReady();

      const values = [[
        partnerData.id,
        partnerData.organizationName,
        partnerData.fullName,
        partnerData.email,
        partnerData.phone || '—',
        partnerData.country,
        partnerData.cityRegion || '—',
        partnerData.partnershipGoal,
        partnerData.tellUsMore || '—',
        'PENDING',
        new Date().toISOString(),
      ]];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, 'A:K'),
        valueInputOption: 'USER_ENTERED',
        resource: { values },
      });

      console.log(`Partner request ${partnerData.organizationName} added to sheet`);
      return true;
    } catch (error) {
      console.error('Error adding partner request to sheet:', error);
      return false;
    }
  }

  async addAcceptedPartnerToSheet(partnerData) {
    try {
      await this.ensureSheetsReady();

      const values = [[
        partnerData.id,
        partnerData.organizationName,
        partnerData.fullName,
        partnerData.email,
        partnerData.phone || '—',
        partnerData.country,
        partnerData.cityRegion || '—',
        partnerData.partnershipGoal,
        'ACCEPTED',
        new Date().toISOString(),
      ]];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, 'A:J'),
        valueInputOption: 'USER_ENTERED',
        resource: { values },
      });

      console.log(`Partner ${partnerData.organizationName} added to Partner Sheet`);
      return true;
    } catch (error) {
      console.error('Error adding accepted partner to sheet:', error);
      return false;
    }
  }

  async updatePartnerRequestStatusInSheet(partnerId, newStatus) {
    try {
      await this.ensureSheetsReady();

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, 'A:K'),
      });

      const rows = response.data.values || [];
      let rowIndex = -1;

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === partnerId) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        console.warn(`Partner with ID ${partnerId} not found`);
        return false;
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, `J${rowIndex + 1}`),
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newStatus]] },
      });

      console.log(`Partner ${partnerId} status updated to ${newStatus}`);
      return true;
    } catch (error) {
      console.error('Error updating partner status in sheet:', error);
      return false;
    }
  }

  async getRejectedPartnerStatusInSheet(partnerId) {
    try {
      await this.ensureSheetsReady();

      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, 'A:K'),
      });

      const rows = response.data.values || [];
      let rowIndex = -1;

      for (let i = 1; i < rows.length; i++) {
        if (rows[i][0] === partnerId) {
          rowIndex = i;
          break;
        }
      }

      if (rowIndex === -1) {
        console.warn(`Partner with ID ${partnerId} not found`);
        return false;
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, `J${rowIndex + 1}`),
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['REJECTED']] },
      });

      console.log(`Partner ${partnerId} marked as REJECTED`);
      return true;
    } catch (error) {
      console.error('Error marking partner as rejected:', error);
      return false;
    }
  }
}

module.exports = new GoogleSheetsService();

