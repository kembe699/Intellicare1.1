const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Visit = sequelize.define('Visit', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    visit_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    patient_id: {
      type: DataTypes.UUID,
      allowNull: false,
      references: {
        model: 'patients',
        key: 'id'
      }
    },
    chief_complaint: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    clinical_notes: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    vitals: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('vitals');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      },
      set(value) {
        this.setDataValue('vitals', typeof value === 'string' ? value : JSON.stringify(value));
      }
    },
    lab_requests: {
      type: DataTypes.TEXT,
      allowNull: true,
      get() {
        const raw = this.getDataValue('lab_requests');
        if (!raw) return null;
        try { return JSON.parse(raw); } catch { return raw; }
      },
      set(value) {
        this.setDataValue('lab_requests', typeof value === 'string' ? value : JSON.stringify(value));
      }
    },
    diagnosis: {
      type: DataTypes.STRING(500),
      allowNull: true
    },
    diagnosis_code: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    patient_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    doctor_name: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    queue_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(20),
      defaultValue: 'pending'
    },
    completed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    closed_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    closed_by: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    clinic_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    doctor_id: {
      type: DataTypes.UUID,
      allowNull: true
    },
    branch_id: {
      type: DataTypes.INTEGER,
      allowNull: true
    }
  }, {
    tableName: 'visits',
    timestamps: true,
    underscored: true
  });

  return Visit;
};
