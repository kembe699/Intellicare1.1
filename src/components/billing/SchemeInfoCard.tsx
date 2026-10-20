import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Shield, CheckCircle, AlertCircle, FileText, DollarSign, Calendar } from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';

interface SchemeInfoCardProps {
  scheme: {
    id: string;
    scheme_name: string;
    scheme_type: string;
    coverage_percentage?: number;
    coverage_limit?: number;
    remaining_limit?: number;
    status?: string;
  };
  preAuthNumber?: string;
  billAmount: number;
  onUpdatePreAuth?: (preAuthNumber: string) => void;
}

export const SchemeInfoCard: React.FC<SchemeInfoCardProps> = ({
  scheme,
  preAuthNumber,
  billAmount,
  onUpdatePreAuth
}) => {
  const { currency } = useCurrency();
  
  const coveragePercentage = scheme.coverage_percentage || 0;
  const schemeCoverage = (billAmount * coveragePercentage) / 100;
  const patientCoPayment = billAmount - schemeCoverage;
  
  const getSchemeTypeBadge = (type: string) => {
    const typeColors: Record<string, string> = {
      insurance: 'bg-primary/10 text-primary border-primary/30',
      corporate: 'bg-purple-100 text-purple-800 border-purple-200',
      govt: 'bg-success-bg text-success border-success-border',
      individual: 'bg-gray-100 text-gray-800 border-gray-200',
      ngo: 'bg-orange-100 text-orange-800 border-orange-200',
      military: 'bg-destructive-bg text-destructive border-destructive-border',
      vip: 'bg-warning-bg text-warning border-warning-border',
    };
    
    return (
      <Badge className={typeColors[type] || 'bg-gray-100 text-gray-800'}>
        <Shield className="w-3 h-3 mr-1" />
        {type.charAt(0).toUpperCase() + type.slice(1)}
      </Badge>
    );
  };

  return (
    <Card className="border-l-4 border-l-info-border">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" />
            Insurance/Scheme Coverage
          </CardTitle>
          {getSchemeTypeBadge(scheme.scheme_type)}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Scheme Details */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground mb-1">Scheme Name</p>
              <p className="font-semibold">{scheme.scheme_name}</p>
            </div>
            
            <div>
              <p className="text-muted-foreground mb-1">Coverage</p>
              <p className="font-semibold text-primary">{coveragePercentage}%</p>
            </div>
            
            {scheme.coverage_limit && (
              <div>
                <p className="text-muted-foreground mb-1">Coverage Limit</p>
                <p className="font-semibold">
                  {currency.code} {scheme.coverage_limit.toLocaleString()}
                </p>
              </div>
            )}
            
            {scheme.remaining_limit !== undefined && (
              <div>
                <p className="text-muted-foreground mb-1">Remaining Limit</p>
                <p className={`font-semibold ${scheme.remaining_limit < 1000 ? 'text-destructive' : 'text-success'}`}>
                  {currency.code} {scheme.remaining_limit.toLocaleString()}
                </p>
              </div>
            )}
          </div>

          {/* Pre-Authorization */}
          {preAuthNumber && (
            <div className="p-3 bg-success-bg border border-success-border rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-success" />
                <div>
                  <p className="text-sm font-medium text-success">Pre-Authorization Approved</p>
                  <p className="text-xs text-success font-mono mt-1">Auth #: {preAuthNumber}</p>
                </div>
              </div>
            </div>
          )}

          {/* Coverage Breakdown */}
          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-3">Coverage Breakdown</p>
            <div className="space-y-2">
              <div className="flex justify-between items-center p-2 bg-primary/10 rounded">
                <span className="text-sm text-foreground">Scheme Coverage ({coveragePercentage}%)</span>
                <span className="font-semibold text-foreground">
                  {currency.code} {schemeCoverage.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center p-2 bg-orange-50 rounded">
                <span className="text-sm text-orange-900">Patient Co-Payment ({100 - coveragePercentage}%)</span>
                <span className="font-semibold text-orange-900">
                  {currency.code} {patientCoPayment.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center p-2 bg-gray-100 rounded font-semibold">
                <span className="text-sm">Total Bill Amount</span>
                <span>{currency.code} {billAmount.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Warnings */}
          {scheme.remaining_limit !== undefined && scheme.remaining_limit < billAmount && (
            <div className="p-3 bg-destructive-bg border border-destructive-border rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-destructive">Coverage Limit Exceeded</p>
                  <p className="text-xs text-destructive mt-1">
                    Bill amount exceeds remaining coverage limit. Patient will pay the excess amount.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
