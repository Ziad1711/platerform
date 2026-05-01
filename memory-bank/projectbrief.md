# Project Brief

## Project Name
**Platerform** - SaaS ERP/eCommerce Platform

## Core Purpose
A comprehensive SaaS platform designed for Moroccan e-commerce businesses to manage their entire business operations with a focus on business intelligence and data-driven decision making.

## Target Market
- Moroccan e-commerce businesses
- French language interface
- Multi-store support for businesses managing multiple shops

## Key Requirements

### Business Management
- Sales and order management
- Product and inventory tracking
- Supplier and expense management
- Advertising cost tracking
- Staff and delivery management
- AI assistant connected to business data
- Analytical dashboard with KPIs

### Technical Requirements
- Multi-tenant architecture (store_id based)
- Row Level Security (RLS) for data isolation
- Real-time data synchronization
- Scalable architecture (< 500k orders: SQL direct, > 500k: metrics table)
- Mobile-responsive interface
- Secure authentication and authorization

### User Roles
- Owner: Full access to all stores
- Admin: Store-level administration
- Staff: Limited operational access
- Confirmation Agent: Order status management only

## Success Criteria
- Intuitive French interface for Moroccan market
- Fast dashboard load times (< 2s)
- Accurate KPI calculations
- Secure multi-tenant data isolation
- Scalable to handle growing order volumes
- AI assistant providing actionable business insights

## Constraints
- Must support multiple currencies with exchange rates
- Must integrate with delivery company APIs
- Must track advertising spend across platforms
- Must maintain detailed audit trails for financial data
- Code files limited to 200-300 lines maximum
