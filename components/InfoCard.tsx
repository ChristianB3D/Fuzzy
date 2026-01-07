
import React from 'react';

interface InfoCardProps {
  title: string;
  icon: string;
  value: string;
  description?: string;
}

const InfoCard: React.FC<InfoCardProps> = ({ title, icon, value, description }) => {
  return (
    <div className="glass p-5 rounded-2xl shadow-sm border border-orange-100 flex items-start gap-4 transition-all hover:shadow-md hover:scale-[1.02]">
      <div className="bg-orange-100 text-orange-800 w-12 h-12 rounded-xl flex items-center justify-center shrink-0">
        <i className={`fa-solid ${icon} text-xl`}></i>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-orange-900/60 mb-1">{title}</h3>
        <p className="text-lg font-bold text-gray-800 leading-tight">{value}</p>
        {description && <p className="text-sm text-gray-500 mt-1">{description}</p>}
      </div>
    </div>
  );
};

export default InfoCard;
