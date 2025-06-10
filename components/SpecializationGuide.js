import React, { useState } from "react";
import { SERVICES_BY_SPECIALIZATION } from "../constants/servicesBySpecialization";

const SPECIALIZATIONS = [
  { key: "nail_tech", label: "Nail Tech" },
  { key: "hair_stylist", label: "Hair Stylist" },
  { key: "barber", label: "Barber" },
  { key: "esthetician", label: "Esthetician" },
  { key: "lash_tech", label: "Lash Tech" },
  { key: "massage_therapist", label: "Massage Therapist" },
  { key: "makeup_artist", label: "Makeup Artist" },
];

export default function SpecializationGuide() {
  const [specialization, setSpecialization] = useState("");

  const services = SERVICES_BY_SPECIALIZATION[specialization] || [];

  return (
    <div className="w-full max-w-lg mx-auto glass-card p-6 rounded-2xl shadow-lg mb-8">
      <label className="block text-lg font-bold mb-2 text-emerald-500">
        Specialization
      </label>
      <select
        className="w-full p-3 mb-4 rounded-xl border bg-white/20 focus:ring-2 focus:ring-emerald-400 text-lg"
        value={specialization}
        onChange={e => setSpecialization(e.target.value)}
      >
        <option value="">-- Select specialization --</option>
        {SPECIALIZATIONS.map(s => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>

      {specialization && (
        <div className="mt-3">
          <div className="font-semibold text-pink-400 mb-2">Typical services:</div>
          <ul className="list-disc pl-6 text-gray-800 dark:text-gray-100 space-y-1">
            {services.map(service => (
              <li key={service} className="text-base">{service}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
