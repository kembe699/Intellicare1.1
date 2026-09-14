import React from 'react';
import { EmployeeListPage } from './EmployeeListPage';

export default function ConsultantsManagement() {
  return (
    <EmployeeListPage
      employmentType="consultant"
      title="Consultants & Doctors"
      singularLabel="Consultant/Doctor"
      subtitle="Consultant and doctor roster, contracts, and fee structures"
      profileBasePath="/hr/consultants"
    />
  );
}
