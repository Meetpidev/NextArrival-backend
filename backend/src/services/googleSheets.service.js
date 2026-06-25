const { google } = require('googleapis');
const { env, getGoogleSheetsKeyJson } = require('../config/env');
const { childLogger } = require('../config/logger');

const logger = childLogger('google-sheets-service');

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
        logger.warn("GOOGLE_SHEETS_SPREADSHEET_ID is not configured. Sheets integration disabled");
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
      logger.info({ sheetTitles }, "Available Google Sheets loaded");

      const matched = sheetTitles.find(t => t.toLowerCase().includes('partner'));
      this.PARTNER_SHEET_NAME = matched || sheetTitles[0];
      logger.info({ sheetName: this.PARTNER_SHEET_NAME }, "Using partner sheet");

    } catch (error) {
      logger.error({ err: error }, "Failed to initialize Google Sheets");
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

      logger.info({ organizationName: partnerData.organizationName }, "Partner request added to sheet");
      return true;
    } catch (error) {
      logger.error({ err: error }, "Error adding partner request to sheet");
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

      logger.info({ organizationName: partnerData.organizationName }, "Partner added to accepted partner sheet");
      return true;
    } catch (error) {
      logger.error({ err: error }, "Error adding accepted partner to sheet");
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
        logger.warn({ partnerId }, "Partner not found in sheet");
        return false;
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, `J${rowIndex + 1}`),
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[newStatus]] },
      });

      logger.info({ partnerId, status: newStatus }, "Partner status updated in sheet");
      return true;
    } catch (error) {
      logger.error({ err: error }, "Error updating partner status in sheet");
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
        logger.warn({ partnerId }, "Partner not found in sheet");
        return false;
      }

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.SPREADSHEET_ID,
        range: this.buildRange(this.PARTNER_SHEET_NAME, `J${rowIndex + 1}`),
        valueInputOption: 'USER_ENTERED',
        resource: { values: [['REJECTED']] },
      });

      logger.info({ partnerId }, "Partner marked as rejected in sheet");
      return true;
    } catch (error) {
      logger.error({ err: error }, "Error marking partner as rejected in sheet");
      return false;
    }
  }
}

module.exports = new GoogleSheetsService();

