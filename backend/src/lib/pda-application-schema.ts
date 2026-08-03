// What a prospective Personal Delivery Agent must provide before a reviewer can
// do anything useful with their application.
//
// This lives in lib/ rather than the route because it is the rule, not the
// plumbing: the browser form runs the same checks as a courtesy, but a public
// endpoint has to assume the browser was skipped entirely. Someone who will
// hold our stock and our customers' cash does not get in on a half-filled form.
import { z } from "zod";

const GuarantorSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  // A guarantor nobody can place is not a guarantor, so how the applicant
  // knows them and where they live are part of the reference, not extras.
  relationship: z.string().trim().min(2, "Say how you know each guarantor.").max(120),
  guarantorType: z.enum(["Family", "Independent"]),
  phone: z.string().trim().min(7).max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  address: z.string().trim().min(4, "Enter each guarantor's address.").max(500),
  occupation: z.string().trim().max(160).optional(),
  workplace: z.string().trim().max(160).optional(),
  yearsKnown: z.string().trim().max(60).optional(),
  referenceStatement: z.string().trim().max(1000).optional(),
  idDocumentPath: z.string().trim().max(500).optional()
});

export const SubmitSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name as written on your ID.").max(160),
  phone: z.string().trim().min(7, "Enter a phone number we can reach you on.").max(40),
  whatsappPhone: z.string().trim().max(40).optional(),
  email: z.string().trim().max(160).optional(),
  dateOfBirth: z.string().trim().min(4, "Enter your date of birth.").max(20),
  gender: z.enum(["Male", "Female", "Prefer not to say"]).optional(),
  state: z.string().trim().min(2, "Choose your state.").max(80),
  city: z.string().trim().min(2, "Enter your city or town.").max(80),
  residentialAddress: z.string().trim().min(4, "Enter your home address.").max(500),
  emergencyContactName: z.string().trim().min(2, "Enter an emergency contact name.").max(160),
  emergencyContactPhone: z.string().trim().min(7, "Enter an emergency contact phone number.").max(40),
  idType: z.enum(["NIN", "Driver's Licence", "Voter's Card", "International Passport"], {
    errorMap: () => ({ message: "Choose which ID you are using." })
  }),
  idNumber: z.string().trim().min(4, "Enter your ID number.").max(60),
  idFrontPath: z.string().trim().min(4, "Upload a photo of your ID.").max(500),
  idBackPath: z.string().trim().max(500).optional(),
  selfiePath: z.string().trim().min(4, "Upload a selfie holding your ID.").max(500),
  proofOfAddressPath: z.string().trim().max(500).optional(),
  transportMethod: z.enum([
    "Motorcycle", "Car", "Public transport", "Bicycle", "Walking", "Hired dispatch", "Other"
  ], { errorMap: () => ({ message: "Say how you move around." }) }),
  vehicleModel: z.string().trim().max(120).optional(),
  vehiclePlate: z.string().trim().max(40).optional(),
  serviceAreas: z.array(z.string().trim().max(80)).min(1, "Say which areas you can deliver to.").max(20),
  bankName: z.string().trim().min(2, "Enter your bank.").max(120),
  bankAccountNumber: z.string().trim().min(6, "Enter your account number.").max(40),
  bankAccountName: z.string().trim().min(2, "Enter your account name.").max(160),
  guarantors: z.array(GuarantorSchema).min(2, "Two guarantors are required.").max(4),
  consent: z.literal(true, { errorMap: () => ({ message: "Please confirm the details are true before submitting." }) })
}).superRefine((value, ctx) => {
  // Two relatives vouching for each other is not independent verification, and
  // the reviewer's approval check refuses the pair anyway - so refuse it at the
  // door rather than letting someone wait on an application that cannot pass.
  if (value.guarantors.every((g) => g.guarantorType === "Family")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "One guarantor must not be family - an employer, landlord, colleague or community leader."
    });
  }
  const digits = (phone: string) => phone.replace(/\D/g, "");
  const numbers = value.guarantors.map((g) => digits(g.phone)).filter(Boolean);
  if (new Set(numbers).size !== numbers.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "Your guarantors must be two different people with two different phone numbers."
    });
  }
  // A guarantor who is really the applicant proves nothing.
  if (numbers.includes(digits(value.phone))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["guarantors"],
      message: "A guarantor cannot be you. Please give someone else's number."
    });
  }
  if (["Motorcycle", "Car"].includes(value.transportMethod) && !value.vehiclePlate?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom, path: ["vehiclePlate"],
      message: "Enter the plate number of the vehicle you deliver with."
    });
  }
});
