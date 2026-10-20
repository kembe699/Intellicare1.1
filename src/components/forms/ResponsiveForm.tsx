import React from 'react';
import { Combobox } from '@/components/ui/combobox';

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'password' | 'number' | 'tel' | 'date' | 'textarea' | 'select';
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  className?: string;
  fullWidth?: boolean;
}

interface ResponsiveFormProps {
  title: string;
  fields: FormField[];
  onSubmit: (data: any) => void;
  submitButtonText?: string;
  columns?: number;
}

export const ResponsiveForm: React.FC<ResponsiveFormProps> = ({
  title,
  fields,
  onSubmit,
  submitButtonText = 'Submit',
  columns = 1,
}) => {
  const [formData, setFormData] = React.useState<any>({});
  const [errors, setErrors] = React.useState<any>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev: any) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-4 sm:px-6 sm:py-6">
      {/* Form Title - Responsive */}
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-4 sm:mb-6">
        {title}
      </h1>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
        {/* Responsive Grid for Form Fields */}
        <div className={`grid grid-cols-1 ${
          columns >= 2 ? 'sm:grid-cols-2' : ''
        } ${
          columns >= 3 ? 'lg:grid-cols-3' : ''
        } gap-4 sm:gap-6`}>
          {fields.map((field) => (
            <div key={field.name} className={field.fullWidth ? 'col-span-full' : ''}>
              {/* Label - Responsive */}
              <label
                htmlFor={field.name}
                className="block text-sm sm:text-base font-medium text-gray-700 mb-2"
              >
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </label>

              {/* Input - Responsive */}
              {field.type === 'textarea' ? (
                <textarea
                  id={field.name}
                  name={field.name}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={handleChange}
                  required={field.required}
                  className="w-full px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none transition min-h-touch"
                  rows={4}
                />
              ) : field.type === 'select' ? (
                <Combobox
                  options={field.options || []}
                  value={formData[field.name] || ''}
                  onChange={(value) => handleSelectChange(field.name, value)}
                  placeholder={`Select ${field.label}`}
                  searchPlaceholder={`Search ${field.label}...`}
                  className="w-full px-3 py-2 sm:px-4 sm:py-3 h-auto text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none transition bg-white min-h-touch"
                />
              ) : (
                <input
                  id={field.name}
                  type={field.type}
                  name={field.name}
                  placeholder={field.placeholder}
                  value={formData[field.name] || ''}
                  onChange={handleChange}
                  required={field.required}
                  className="w-full px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none transition min-h-touch"
                />
              )}

              {/* Error Message - Responsive */}
              {errors[field.name] && (
                <p className="text-destructive text-xs sm:text-sm mt-1">
                  {errors[field.name]}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Submit Button - Full Width on Mobile */}
        <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-4 sm:pt-6">
          <button
            type="submit"
            className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-primary text-white font-semibold rounded-lg hover:bg-primary-hover active:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-ring transition text-sm sm:text-base min-h-touch"
          >
            {submitButtonText}
          </button>
          <button
            type="button"
            onClick={() => setFormData({})}
            className="w-full sm:w-auto px-6 sm:px-8 py-3 sm:py-4 bg-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-400 active:bg-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400 transition text-sm sm:text-base min-h-touch"
          >
            Clear
          </button>
        </div>
      </form>
    </div>
  );
};
