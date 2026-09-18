const { DataTypes } = require('sequelize');

// Singleton row (id always 1) holding the vendor's own letterhead details —
// the company issuing quotations, not a tenant's facility. Mirrors the
// tenant side's facility-info-feeds-every-document pattern (useFacilityInfo)
// so nothing about the issuing company is ever hardcoded into a template.
module.exports = (sequelize) => {
  const CompanyProfile = sequelize.define('CompanyProfile', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
    },
    company_name: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: 'NILE HIVE CONCEPT CO. LTD',
    },
    address: { type: DataTypes.STRING, allowNull: true },
    city: { type: DataTypes.STRING, allowNull: true },
    phone: { type: DataTypes.STRING, allowNull: true },
    email: { type: DataTypes.STRING, allowNull: true },
    website: { type: DataTypes.STRING, allowNull: true },
    // Data URI, same convention as the tenant side's facility logo — a print
    // window carries no auth, so a logo served from a protected endpoint
    // would silently fail to load there.
    logo: { type: DataTypes.TEXT, allowNull: true },
    bank_name: { type: DataTypes.STRING, allowNull: true },
    bank_account_name: { type: DataTypes.STRING, allowNull: true },
    bank_account_number: { type: DataTypes.STRING, allowNull: true },
    bank_swift: { type: DataTypes.STRING, allowNull: true },
  }, {
    tableName: 'platform_company_profile',
    timestamps: true,
    underscored: true,
  });

  return CompanyProfile;
};
