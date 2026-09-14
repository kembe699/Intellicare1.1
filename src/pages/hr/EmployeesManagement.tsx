import React from 'react';
import { EmployeeListPage } from './EmployeeListPage';

export default function EmployeesManagement() {
  return (
    <EmployeeListPage
      employmentType="staff"
      title="Employees"
      singularLabel="Employee"
      subtitle="Staff records, employment details, and salary structures"
      profileBasePath="/hr/employees"
    />
  );
}
