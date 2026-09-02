// Test data and utilities for Mindray integration testing
export const mockHL7CBCMessage = `MSH|^~\\&|MINDRAY|BC6800|CLINIC|LAB|20241221034200||ORU^R01|MSG001|P|2.5
PID|1||CBC001^^^CLINIC^MR||DOE^JOHN||19800101|M|||123 MAIN ST^^CITY^ST^12345||555-1234|||||||||||||||||||
OBR|1||CBC001|CBC^Complete Blood Count^L|||20241221034000|||||||20241221034200||||||||||F
OBX|1|NM|WBC^White Blood Cell Count^L|1|7.2|10^9/L|4.0-10.0|N|||F
OBX|2|NM|LYM#^Lymphocyte Count^L|1|2.1|10^9/L|0.8-4.0|N|||F
OBX|3|NM|MON#^Monocyte Count^L|1|0.5|10^9/L|0.1-1.5|N|||F
OBX|4|NM|NEU#^Neutrophil Count^L|1|4.6|10^9/L|2.0-7.0|N|||F
OBX|5|NM|LYM%^Lymphocyte Percentage^L|1|29.2|%|20.0-40.0|N|||F
OBX|6|NM|MON%^Monocyte Percentage^L|1|6.9|%|3.0-15.0|N|||F
OBX|7|NM|NEU%^Neutrophil Percentage^L|1|63.9|%|50.0-70.0|N|||F
OBX|8|NM|RBC^Red Blood Cell Count^L|1|4.5|10^12/L|3.50-5.50|N|||F
OBX|9|NM|HGB^Hemoglobin^L|1|13.8|g/dL|11.0-16.0|N|||F
OBX|10|NM|HCT^Hematocrit^L|1|41.2|%|37.0-54.0|N|||F
OBX|11|NM|MCV^Mean Cell Volume^L|1|91.6|fL|80.0-100.0|N|||F
OBX|12|NM|MCH^Mean Cell Hemoglobin^L|1|30.7|pg|27.0-34.0|N|||F
OBX|13|NM|MCHC^Mean Cell Hemoglobin Concentration^L|1|33.5|g/dL|32.0-36.0|N|||F
OBX|14|NM|RDW-CV^Red Cell Distribution Width CV^L|1|13.2|%|11.0-16.0|N|||F
OBX|15|NM|RDW-SD^Red Cell Distribution Width SD^L|1|42.1|fL|35.0-56.0|N|||F
OBX|16|NM|PLT^Platelet Count^L|1|285|10^9/L|150-450|N|||F
OBX|17|NM|MPV^Mean Platelet Volume^L|1|8.9|fL|6.5-12.0|N|||F
OBX|18|NM|PDW^Platelet Distribution Width^L|1|16.2|fL|15.0-17.0|N|||F
OBX|19|NM|PCT^Plateletcrit^L|1|0.254|%|0.108-0.282|N|||F
OBX|20|NM|P-LCR^Platelet Large Cell Ratio^L|1|28.5|%|11.0-45.0|N|||F`;

export const mockAbnormalCBCMessage = `MSH|^~\\&|MINDRAY|BC6800|CLINIC|LAB|20241221034200||ORU^R01|MSG002|P|2.5
PID|1||CBC002^^^CLINIC^MR||SMITH^JANE||19750515|F|||456 OAK AVE^^CITY^ST^12345||555-5678|||||||||||||||||||
OBR|1||CBC002|CBC^Complete Blood Count^L|||20241221034000|||||||20241221034200||||||||||F
OBX|1|NM|WBC^White Blood Cell Count^L|1|12.5|10^9/L|4.0-10.0|H|||F
OBX|2|NM|LYM#^Lymphocyte Count^L|1|1.8|10^9/L|0.8-4.0|N|||F
OBX|3|NM|MON#^Monocyte Count^L|1|0.8|10^9/L|0.1-1.5|N|||F
OBX|4|NM|NEU#^Neutrophil Count^L|1|9.9|10^9/L|2.0-7.0|H|||F
OBX|5|NM|LYM%^Lymphocyte Percentage^L|1|14.4|%|20.0-40.0|L|||F
OBX|6|NM|MON%^Monocyte Percentage^L|1|6.4|%|3.0-15.0|N|||F
OBX|7|NM|NEU%^Neutrophil Percentage^L|1|79.2|%|50.0-70.0|H|||F
OBX|8|NM|RBC^Red Blood Cell Count^L|1|3.2|10^12/L|3.50-5.50|L|||F
OBX|9|NM|HGB^Hemoglobin^L|1|9.5|g/dL|11.0-16.0|L|||F
OBX|10|NM|HCT^Hematocrit^L|1|28.5|%|37.0-54.0|L|||F
OBX|11|NM|MCV^Mean Cell Volume^L|1|89.1|fL|80.0-100.0|N|||F
OBX|12|NM|MCH^Mean Cell Hemoglobin^L|1|29.7|pg|27.0-34.0|N|||F
OBX|13|NM|MCHC^Mean Cell Hemoglobin Concentration^L|1|33.3|g/dL|32.0-36.0|N|||F
OBX|14|NM|RDW-CV^Red Cell Distribution Width CV^L|1|15.8|%|11.0-16.0|N|||F
OBX|15|NM|RDW-SD^Red Cell Distribution Width SD^L|1|48.2|fL|35.0-56.0|N|||F
OBX|16|NM|PLT^Platelet Count^L|1|125|10^9/L|150-450|L|||F
OBX|17|NM|MPV^Mean Platelet Volume^L|1|10.2|fL|6.5-12.0|N|||F
OBX|18|NM|PDW^Platelet Distribution Width^L|1|16.8|fL|15.0-17.0|N|||F
OBX|19|NM|PCT^Plateletcrit^L|1|0.128|%|0.108-0.282|N|||F
OBX|20|NM|P-LCR^Platelet Large Cell Ratio^L|1|32.1|%|11.0-45.0|N|||F`;

export const testCBCComponents = [
  { name: 'WBC', expectedValue: '7.2', unit: '10^9/L', normalRange: '4.0-10.0' },
  { name: 'Lymph#', expectedValue: '2.1', unit: '10^9/L', normalRange: '0.8-4.0' },
  { name: 'Mid#', expectedValue: '0.5', unit: '10^9/L', normalRange: '0.1-1.5' },
  { name: 'Gran#', expectedValue: '4.6', unit: '10^9/L', normalRange: '2.0-7.0' },
  { name: 'Lymph%', expectedValue: '29.2', unit: '%', normalRange: '20.0-40.0' },
  { name: 'Mid%', expectedValue: '6.9', unit: '%', normalRange: '3.0-15.0' },
  { name: 'Gran%', expectedValue: '63.9', unit: '%', normalRange: '50.0-70.0' },
  { name: 'RBC', expectedValue: '4.5', unit: '10^12/L', normalRange: '3.50-5.50' },
  { name: 'HGB', expectedValue: '13.8', unit: 'g/dL', normalRange: '11.0-16.0' },
  { name: 'HCT', expectedValue: '41.2', unit: '%', normalRange: '37.0-54.0' },
  { name: 'MCV', expectedValue: '91.6', unit: 'fL', normalRange: '80.0-100.0' },
  { name: 'MCH', expectedValue: '30.7', unit: 'pg', normalRange: '27.0-34.0' },
  { name: 'MCHC', expectedValue: '33.5', unit: 'g/dL', normalRange: '32.0-36.0' },
  { name: 'RDW-CV', expectedValue: '13.2', unit: '%', normalRange: '11.0-16.0' },
  { name: 'RDW-SD', expectedValue: '42.1', unit: 'fL', normalRange: '35.0-56.0' },
  { name: 'PLT', expectedValue: '285', unit: '10^9/L', normalRange: '150-450' },
  { name: 'MPV', expectedValue: '8.9', unit: 'fL', normalRange: '6.5-12.0' },
  { name: 'PDW', expectedValue: '16.2', unit: 'fL', normalRange: '15.0-17.0' },
  { name: 'PCT', expectedValue: '0.254', unit: '%', normalRange: '0.108-0.282' },
  { name: 'P-LCR', expectedValue: '28.5', unit: '%', normalRange: '11.0-45.0' }
];

// Test function to validate HL7 parsing
export function testHL7Parsing() {
  console.log('Testing Mindray HL7 CBC Integration...');
  
  // This would be used in actual testing
  const testResults = {
    normalCBC: mockHL7CBCMessage,
    abnormalCBC: mockAbnormalCBCMessage,
    expectedComponents: testCBCComponents
  };
  
  console.log('Test data prepared for:', testResults.expectedComponents.length, 'CBC components');
  return testResults;
}
